#!/usr/bin/env node

import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';

const PHOTOS_DIR = './photos_to_process';
const PUBLIC_PHOTOS = './public/photos';
const PUBLIC_THUMBS = './public/thumbnails';
const MANIFEST_PATH = './src/data/photos.json';

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

function parseFilename(filename) {
  const name = parse(filename).name;
  const m = name.match(/^(.+)_(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m) {
    const [, titlePart, day, month, year] = m;
    const title = titlePart.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return { title, date };
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

async function readExistingManifest() {
  try {
    const data = await readFile(join(process.cwd(), MANIFEST_PATH), 'utf-8');
    const entries = JSON.parse(data);
    const map = {};
    for (const e of entries) map[e.slug] = e;
    return map;
  } catch {
    return {};
  }
}

async function main() {
  const inputDir = join(process.cwd(), PHOTOS_DIR);

  if (!existsSync(inputDir)) {
    console.error(`No ${PHOTOS_DIR} directory found.`);
    process.exit(1);
  }

  await mkdir(join(process.cwd(), PUBLIC_PHOTOS), { recursive: true });
  await mkdir(join(process.cwd(), PUBLIC_THUMBS), { recursive: true });

  const files = (await readdir(inputDir)).filter(f => /\.jpe?g$/i.test(f));
  console.log(`Found ${files.length} photos to process\n`);

  // Clean stale WebP files
  const validSlugs = new Set(files.map(f => slugify(parse(f).name)));
  for (const dir of [PUBLIC_PHOTOS, PUBLIC_THUMBS]) {
    const dirPath = join(process.cwd(), dir);
    if (!existsSync(dirPath)) continue;
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      if (!entry.endsWith('.webp')) continue;
      const slug = parse(entry).name;
      if (!validSlugs.has(slug)) {
        await unlink(join(dirPath, entry));
        console.log(`  Deleted stale: ${dir.split('/').pop()}/${entry}`);
      }
    }
  }

  const existing = await readExistingManifest();
  const photos = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(inputDir, file);
    const idx = `[${i + 1}/${files.length}]`;
    const slug = slugify(parse(file).name);

    const parsed = parseFilename(file);
    const prev = existing[slug] || {};

    let exif = {};
    try {
      exif = await exifr.parse(filePath, true);
    } catch {}

    const make = exif?.Make || '';
    const model = exif?.Model || '';
    const camera = [make, model].filter(Boolean).join(' ').trim() || '';

    let date = parsed.date;
    if (!date && exif?.DateTimeOriginal) {
      date = new Date(exif.DateTimeOriginal).toISOString().slice(0, 10);
    }

    const lat = exif?.latitude ?? null;
    const lng = exif?.longitude ?? null;
    const description = exif?.ImageDescription || exif?.Description || '';

    // Tags: single year from date
    const tags = date ? [date.slice(0, 4)] : [];

    const title = parsed.title || titleFromSlug(slug);

    let imgWidth = exif?.ExifImageWidth || 0;
    let imgHeight = exif?.ExifImageHeight || 0;

    console.log(`${idx} ${slug}`);

    try {
      const image = sharp(filePath);
      const meta = await image.metadata();
      if (!imgWidth) imgWidth = meta.width || 0;
      if (!imgHeight) imgHeight = meta.height || 0;

      const fullPath = join(process.cwd(), PUBLIC_PHOTOS, `${slug}.webp`);
      await image
        .clone()
        .resize(2000, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(fullPath);

      const thumbPath = join(process.cwd(), PUBLIC_THUMBS, `${slug}.webp`);
      await image
        .clone()
        .resize(500, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);

      // Build location: prefer existing place name, fallback to coords
      let location = null;
      if (lat != null && lng != null) {
        const prevName = prev.location?.name;
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
        category: prev.category || 'uncategorized',
        tags,
        location,
        country: prev.country || null,
        date: date || null,
        camera: camera || null,
        thumbnail: `/photo/thumbnails/${slug}.webp`,
        fullsize: `/photo/photos/${slug}.webp`,
        width: imgWidth,
        height: imgHeight,
      });

      console.log(`  ✓ ${title}${date ? ` (${date})` : ''}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  photos.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.slug.localeCompare(b.slug));
  await writeFile(MANIFEST_PATH, JSON.stringify(photos, null, 2) + '\n');
  console.log(`\nWrote ${photos.length} photos to ${MANIFEST_PATH}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
