#!/usr/bin/env node

import { readFile, readdir, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import exifr from 'exifr';
import 'dotenv/config';

const PHOTOS_DIR = './photos_to_process';
const PUBLIC_PHOTOS = './public/photos';
const PUBLIC_THUMBS = './public/thumbnails';
const MANIFEST_PATH = './src/data/photos.json';
const UPLOAD = process.argv.includes('--upload');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

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
  const m = name.match(/^(.+)_(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m) {
    const [, titlePart, day, month, year] = m;
    const title = titlePart.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { title, date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` };
  }
  const m2 = name.match(/^_?(\d+)_?(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m2) {
    const [, , day, month, year] = m2;
    return { title: null, date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` };
  }
  return { title: null, date: null };
}

function isCoordString(s) {
  return /^-?\d+\.\d+/.test(s);
}

async function readJSON(path) {
  try {
    return JSON.parse(await readFile(join(process.cwd(), path), 'utf-8'));
  } catch {
    return [];
  }
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

async function r2Exists(key) {
  try {
    await getR2Client().send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

async function uploadToR2(filePath, key) {
  const exists = await r2Exists(key);
  if (exists) return false;
  try {
    const file = await readFile(filePath);
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: file,
        ContentType: 'image/webp',
      }),
    );
    return true;
  } catch {
    return false;
  }
}

async function geocodePlace(query) {
  const https = await import('node:https');
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  return new Promise(resolve => {
    https
      .get(url, { headers: { 'User-Agent': 'portfolio-process/1.0' } }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.length > 0)
              resolve({
                lat: parseFloat(parsed[0].lat),
                lng: parseFloat(parsed[0].lon),
                name: parsed[0].display_name,
              });
            else resolve(null);
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

async function writeExif(filePath, updates) {
  const args = ['-overwrite_original'];
  for (const [tag, val] of Object.entries(updates)) {
    if (tag === 'GPSLatitude') args.push(`-GPSLatitude=${val}`);
    else if (tag === 'GPSLatitudeRef') args.push(`-GPSLatitudeRef=${val}`);
    else if (tag === 'GPSLongitude') args.push(`-GPSLongitude=${val}`);
    else if (tag === 'GPSLongitudeRef') args.push(`-GPSLongitudeRef=${val}`);
    else if (tag === 'DateTimeOriginal') args.push(`-DateTimeOriginal=${val}`);
    else if (tag === 'Make') args.push(`-Make=${val}`);
    else if (tag === 'Model') args.push(`-Model=${val}`);
  }
  args.push(filePath);
  return new Promise(resolve => {
    execFile('exiftool', args, (err, stdout, stderr) => {
      if (err) resolve(false);
      else resolve(true);
    });
  });
}

async function promptForMissing(filePath, slug, exif) {
  console.log(`\n  ⚠ ${slug} is missing required EXIF data\n`);

  const make = exif?.Make || '';
  const model = exif?.Model || '';
  const camera = [make, model].filter(Boolean).join(' ').trim();

  const parsed = parseFilename(parse(filePath).name);
  let date = parsed.date;
  if (!date && exif?.DateTimeOriginal) {
    date = new Date(exif.DateTimeOriginal).toISOString().slice(0, 10);
  }
  const lat = exif?.latitude ?? null;
  const lng = exif?.longitude ?? null;

  const exifUpdates = {};

  if (!date) {
    const guess = parsed.date || '';
    const answer = await ask(`    date (YYYY-MM-DD)${guess ? ` [${guess}]` : ''}: `);
    const val = answer.trim() || guess;
    if (val) {
      exifUpdates.DateTimeOriginal = `${val.replace(/-/g, ':')} 12:00:00`;
      date = val;
    }
  }

  if (lat == null || lng == null) {
    const answer = await ask('    location (place name or lat,lng): ');
    const trimmed = answer.trim();
    if (trimmed) {
      if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(trimmed.replace(/\s/g, ''))) {
        const [la, ln] = trimmed.replace(/\s/g, '').split(',').map(Number);
        exifUpdates.GPSLatitudeRef = la >= 0 ? 'North' : 'South';
        exifUpdates.GPSLatitude = Math.abs(la);
        exifUpdates.GPSLongitudeRef = ln >= 0 ? 'East' : 'West';
        exifUpdates.GPSLongitude = Math.abs(ln);
      } else {
        console.log(`    geocoding "${trimmed}"...`);
        const coords = await geocodePlace(trimmed);
        if (coords) {
          console.log(`    → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
          exifUpdates.GPSLatitudeRef = coords.lat >= 0 ? 'North' : 'South';
          exifUpdates.GPSLatitude = Math.abs(coords.lat);
          exifUpdates.GPSLongitudeRef = coords.lng >= 0 ? 'East' : 'West';
          exifUpdates.GPSLongitude = Math.abs(coords.lng);
        } else {
          console.log('    geocoding failed');
        }
      }
    }
  }

  if (!camera) {
    const answer = await ask('    camera (e.g. "Canon EOS 70D"): ');
    const trimmed = answer.trim();
    if (trimmed) {
      const parts = trimmed.split(/\s+/);
      exifUpdates.Make = parts[0];
      exifUpdates.Model = parts.slice(1).join(' ') || parts[0];
    }
  }

  if (Object.keys(exifUpdates).length > 0) {
    console.log('    writing to EXIF...');
    await writeExif(filePath, exifUpdates);
    console.log('    done\n');
  } else {
    console.log('    nothing to update\n');
  }
}

async function main() {
  const srcDir = join(process.cwd(), PHOTOS_DIR);
  if (!existsSync(srcDir)) {
    console.error(`Directory not found: ${PHOTOS_DIR}`);
    process.exit(1);
  }

  await mkdir(join(process.cwd(), PUBLIC_PHOTOS), { recursive: true });
  await mkdir(join(process.cwd(), PUBLIC_THUMBS), { recursive: true });

  const files = (await readdir(srcDir)).filter(f => /\.jpe?g$/i.test(f));
  console.log(`\n  Source JPGs: ${files.length}\n`);

  const existing = await readJSON(MANIFEST_PATH);
  const existingMap = {};
  for (const e of existing) existingMap[e.slug] = e;

  const jpgSlugs = new Set(files.map(f => slugify(parse(f).name)));

  // Clean stale WebP files
  let stale = 0;
  for (const dir of [PUBLIC_PHOTOS, PUBLIC_THUMBS]) {
    const dirPath = join(process.cwd(), dir);
    if (!existsSync(dirPath)) continue;
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      if (!entry.endsWith('.webp')) continue;
      const s = parse(entry).name;
      if (!jpgSlugs.has(s)) {
        await unlink(join(dirPath, entry));
        stale++;
      }
    }
  }
  if (stale > 0) console.log(`  Cleaned ${stale} stale WebP files\n`);

  // Remove orphaned manifest entries
  const orphans = existing.filter(p => !jpgSlugs.has(p.slug));
  if (orphans.length > 0) {
    for (const o of orphans) existingMap[o.slug] = undefined;
    console.log(`  Removed ${orphans.length} orphaned manifest entries\n`);
  }

  const photos = [];
  let processed = 0,
    skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let filePath = join(srcDir, file);
    let slug = slugify(parse(file).name);
    const idx = `[${i + 1}/${files.length}]`;
    let prev = existingMap[slug];

    let exif = {};
    try {
      exif = await exifr.parse(filePath, true);
    } catch {}

    const isNew = !prev;
    if (isNew) {
      const exifDate = exif?.DateTimeOriginal
        ? new Date(exif.DateTimeOriginal)
        : null;
      const parsedOrig = parseFilename(parse(file).name);
      const dateStr = exifDate
        ? `${String(exifDate.getDate()).padStart(2, '0')}_${String(exifDate.getMonth() + 1).padStart(2, '0')}_${exifDate.getFullYear()}`
        : parsedOrig.date
          ? parsedOrig.date.replace(/-/g, '_')
          : null;
      const ans = await ask(
        `    rename file${dateStr ? ` (date: ${dateStr.replace(/_/g, '/')})` : ''}\n      current: ${file}\n      new name (description only, date will be appended): `,
      );
      const trimmed = ans.trim().replace(/\.jpe?g$/i, '');
      if (trimmed) {
        const safeDesc = trimmed.replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '_');
        const newBase = dateStr ? `${safeDesc}_${dateStr}` : safeDesc;
        const newName = newBase + '.jpg';
        const newPath = join(srcDir, newName);
        await rename(filePath, newPath);
        slug = slugify(newBase);
        filePath = newPath;
        prev = existingMap[slug] || null;
      }
      await promptForMissing(filePath, slug, exif);
      // Re-read EXIF after potential updates
      try {
        exif = await exifr.parse(filePath, true);
      } catch {}
    }

    const parsed = parseFilename(parse(filePath).name);
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

    if (isNew && (!date || lat == null || lng == null || !camera)) {
      console.log(`  ${idx} ✗ ${slug} — still missing required data after prompt, skipping`);
      skipped++;
      continue;
    }

    let imgWidth = exif?.ExifImageWidth || 0;
    let imgHeight = exif?.ExifImageHeight || 0;

    try {
      const image = sharp(filePath);
      const meta = await image.metadata();
      if (!imgWidth) imgWidth = meta.width || 0;
      if (!imgHeight) imgHeight = meta.height || 0;

      const fullPath = join(process.cwd(), PUBLIC_PHOTOS, `${slug}.webp`);
      const needsFull = !existsSync(fullPath);
      if (needsFull) {
        await image
          .clone()
          .resize(2000, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(fullPath);
      }

      const thumbPath = join(process.cwd(), PUBLIC_THUMBS, `${slug}.webp`);
      const needsThumb = !existsSync(thumbPath);
      if (needsThumb) {
        await image
          .clone()
          .resize(500, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(thumbPath);
      }

      let location = null;
      if (lat != null && lng != null) {
        const prevName = prev?.location?.name;
        if (prevName && !isCoordString(prevName)) {
          location = { name: prevName, lat, lng };
        } else {
          location = { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng };
        }
      }

      photos.push({
        slug,
        title,
        description,
        category: prev?.category || 'uncategorized',
        tags,
        location,
        country: prev?.country || null,
        date: date || null,
        camera: camera || null,
        thumbnail: `/photo/thumbnails/${slug}.webp`,
        fullsize: `/photo/photos/${slug}.webp`,
        width: imgWidth,
        height: imgHeight,
      });

      if (UPLOAD) {
        await uploadToR2(fullPath, `photography/${slug}.webp`);
        await uploadToR2(thumbPath, `thumbnails/${slug}.webp`);
      }

      const status = [];
      if (isNew) status.push('new');
      if (needsFull) status.push('fullsize');
      if (needsThumb) status.push('thumbnail');
      if (UPLOAD) status.push('uploaded');
      console.log(
        `  ${idx} ${status.length > 0 ? '→' : '✓'} ${slug}${status.length > 0 ? ` (${status.join(', ')})` : ''}`,
      );
      processed++;
    } catch (err) {
      console.error(`  ${idx} ✗ ${slug}: ${err.message}`);
      skipped++;
    }
  }

  photos.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.slug.localeCompare(b.slug));
  await writeFile(MANIFEST_PATH, JSON.stringify(photos, null, 2) + '\n');

  console.log(`\n  Done: ${processed} processed, ${skipped} skipped, ${photos.length} in manifest`);
  rl.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
