#!/usr/bin/env node

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import exifr from 'exifr';
import 'dotenv/config';

const PHOTOS_DIR = './photos_to_process';
const PUBLIC_PHOTOS = './public/photos';
const PUBLIC_THUMBS = './public/thumbnails';
const MANIFEST_PATH = './src/data/photos.json';
const R2_PHOTO_PREFIX = 'photography/';
const R2_THUMB_PREFIX = 'thumbnails/';

const VALIDATE_ONLY = process.argv.includes('--validate-only');
const NO_UPLOAD = process.argv.includes('--no-upload');
const FORCE = process.argv.includes('--force');

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseFilename(name) {
  const base = parse(name).name;
  const m = base.match(/^(.+)_(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m) {
    const [, titlePart, day, month, year] = m;
    return {
      title: titlePart.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    };
  }
  const m2 = base.match(/^_?(\d+)_?(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m2) {
    const [, , day, month, year] = m2;
    return { title: null, date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` };
  }
  return { title: null, date: null };
}

function isCoordString(s) {
  return /^-?\d+\.\d+/.test(s);
}

function formatShutterSpeed(expTime) {
  if (expTime == null) return null;
  if (expTime < 1) {
    const denom = Math.round(1 / expTime);
    return `1/${denom}`;
  }
  return `${expTime}s`;
}

let r2Client = null;
function getR2Client() {
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return r2Client;
}

async function listR2Objects(prefix) {
  const keys = [];
  let token;
  do {
    const res = await getR2Client().send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function uploadToR2(filePath, key) {
  const file = await readFile(filePath);
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file,
      ContentType: 'image/webp',
    }),
  );
}

async function validateJPGs(files) {
  const srcDir = join(process.cwd(), PHOTOS_DIR);
  console.log(`\nValidating ${files.length} source JPGs...\n`);
  let valid = 0, invalid = 0;

  for (const file of files) {
    const filePath = join(srcDir, file);
    const slug = slugify(parse(file).name);
    const issues = [];

    let exif = {};
    try {
      exif = await exifr.parse(filePath, true);
    } catch {
      issues.push('EXIF unreadable');
    }

    const parsed = parseFilename(file);
    const hasFilenameDate = !!parsed.date;
    const hasExifDate = !!exif?.DateTimeOriginal;
    if (!hasFilenameDate && !hasExifDate) issues.push('no date');

    const lat = exif?.latitude;
    const lng = exif?.longitude;
    if (lat == null || lng == null) issues.push('missing GPS');

    const make = exif?.Make || '';
    const model = exif?.Model || '';
    if (!make && !model) issues.push('missing camera');

    try {
      const meta = await sharp(filePath).metadata();
      if (!meta.width || !meta.height) issues.push('bad dimensions');
    } catch {
      issues.push('unreadable image');
    }

    if (issues.length) {
      console.log(`  ✗ ${slug}  ${issues.join(', ')}`);
      invalid++;
    } else {
      console.log(`  ✓ ${slug}`);
      valid++;
    }
  }

  console.log(`\n  ${valid} valid, ${invalid} invalid\n`);
  return { valid, invalid };
}

async function main() {
  const srcDir = join(process.cwd(), PHOTOS_DIR);
  if (!existsSync(srcDir)) {
    console.error(`Missing ${PHOTOS_DIR}`);
    process.exit(1);
  }

  const files = (await readdir(srcDir)).filter(f => /\.jpe?g$/i.test(f));
  if (!files.length) {
    console.log('No JPGs found in photos_to_process/.');
    return;
  }

  const { invalid } = await validateJPGs(files);
  if (VALIDATE_ONLY) process.exit(invalid ? 1 : 0);
  if (invalid) {
    console.warn(`${invalid} file(s) have issues — will skip if no existing manifest entry\n`);
  }

  let r2Photos = new Set();
  let r2Thumbs = new Set();
  const upload = !NO_UPLOAD;
  if (upload) {
    console.log('Listing existing R2 objects for diff...');
    const [photoKeys, thumbKeys] = await Promise.all([
      listR2Objects(R2_PHOTO_PREFIX),
      listR2Objects(R2_THUMB_PREFIX),
    ]);
    r2Photos = new Set(photoKeys);
    r2Thumbs = new Set(thumbKeys);
    console.log(`  ${r2Photos.size} photos, ${r2Thumbs.size} thumbnails on R2\n`);
  }

  await mkdir(join(process.cwd(), PUBLIC_PHOTOS), { recursive: true });
  await mkdir(join(process.cwd(), PUBLIC_THUMBS), { recursive: true });

  let existing = {};
  try {
    const data = JSON.parse(await readFile(join(process.cwd(), MANIFEST_PATH), 'utf-8'));
    for (const p of data) existing[p.slug] = p;
  } catch {}

  const validSlugs = new Set(files.map(f => slugify(parse(f).name)));

  let stale = 0;
  for (const dir of [PUBLIC_PHOTOS, PUBLIC_THUMBS]) {
    const dirPath = join(process.cwd(), dir);
    if (!existsSync(dirPath)) continue;
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      if (!entry.endsWith('.webp')) continue;
      if (!validSlugs.has(parse(entry).name)) {
        await unlink(join(dirPath, entry));
        stale++;
      }
    }
  }
  if (stale > 0) console.log(`Removed ${stale} stale local WebP files\n`);

  const photos = [];
  let generated = 0, uploaded = 0, skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(srcDir, file);
    const slug = slugify(parse(file).name);
    const prev = existing[slug] || {};
    const idx = `[${i + 1}/${files.length}]`;

    let exif = {};
    try {
      exif = await exifr.parse(filePath, true);
    } catch {}

    const parsed = parseFilename(file);
    const make = exif?.Make || '';
    const model = exif?.Model || '';
    const camera = [make, model].filter(Boolean).join(' ').trim() || null;

    let date = parsed.date;
    if (!date && exif?.DateTimeOriginal) {
      date = new Date(exif.DateTimeOriginal).toISOString().slice(0, 10);
    }

    const lat = exif?.latitude ?? null;
    const lng = exif?.longitude ?? null;
    const description = exif?.ImageDescription || exif?.Description || '';
    const title = parsed.title || titleFromSlug(slug);
    const tags = date ? [date.slice(0, 4)] : [];
    const iso = exif?.ISO ?? null;
    const aperture = exif?.FNumber != null ? `f/${exif.FNumber}` : null;
    const focalLength = exif?.FocalLength != null ? `${Math.round(exif.FocalLength)} mm` : null;
    const shutterSpeed = formatShutterSpeed(exif?.ExposureTime);

    try {
      const image = sharp(filePath);
      const meta = await image.metadata();
      const imgWidth = exif?.ExifImageWidth || meta.width || 0;
      const imgHeight = exif?.ExifImageHeight || meta.height || 0;

      const fullPath = join(process.cwd(), PUBLIC_PHOTOS, `${slug}.webp`);
      const thumbPath = join(process.cwd(), PUBLIC_THUMBS, `${slug}.webp`);
      const needsFull = !existsSync(fullPath);
      const needsThumb = !existsSync(thumbPath);

      if (needsFull) {
        await image
          .clone()
          .resize(2000, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(fullPath);
        generated++;
      }

      if (needsThumb) {
        await image
          .clone()
          .resize(500, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(thumbPath);
        generated++;
      }

      if (upload) {
        const photoKey = `${R2_PHOTO_PREFIX}${slug}.webp`;
        const thumbKey = `${R2_THUMB_PREFIX}${slug}.webp`;

        if (FORCE || !r2Photos.has(photoKey)) {
          await uploadToR2(fullPath, photoKey);
          uploaded++;
        }
        if (FORCE || !r2Thumbs.has(thumbKey)) {
          await uploadToR2(thumbPath, thumbKey);
          uploaded++;
        }
      }

      let location = null;
      if (lat != null && lng != null) {
        const prevName = prev.location?.name;
        if (prevName && !isCoordString(prevName)) {
          location = { name: prevName, lat, lng };
        } else {
          location = { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng };
        }
      }

      const entry = { ...prev };
      entry.slug = slug;
      entry.title = title;
      entry.description = description;
      entry.tags = tags;
      entry.location = location;
      entry.date = date || null;
      entry.camera = camera || null;
      entry.thumbnail = `/photo/thumbnails/${slug}.webp`;
      entry.fullsize = `/photo/photos/${slug}.webp`;
      entry.width = imgWidth;
      entry.height = imgHeight;
      entry.category = prev.category || 'uncategorized';
      entry.iso = iso;
      entry.aperture = aperture;
      entry.focalLength = focalLength;
      entry.shutterSpeed = shutterSpeed;
      entry.country = prev.country ?? null;
      photos.push(entry);

      const status = [];
      if (needsFull) status.push('fullsize');
      if (needsThumb) status.push('thumb');
      if (upload && (FORCE || !r2Photos.has(`${R2_PHOTO_PREFIX}${slug}.webp`))) status.push('uploaded');
      console.log(`  ${idx} ${status.length ? '→' : '✓'} ${slug}${status.length ? ` (${status.join(', ')})` : ''}`);
    } catch (err) {
      console.error(`  ${idx} ✗ ${slug}: ${err.message}`);
      skipped++;
    }
  }

  photos.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.slug.localeCompare(b.slug));
  await writeFile(join(process.cwd(), MANIFEST_PATH), JSON.stringify(photos, null, 2) + '\n');

  console.log(`\nDone: ${photos.length} in manifest, ${generated} generated, ${uploaded} uploaded to R2, ${skipped} skipped`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
