#!/usr/bin/env node

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';

const PHOTOS_DIR = './photos_to_process';
const PUBLIC_PHOTOS = './public/photos';
const PUBLIC_THUMBS = './public/thumbnails';
const MANIFEST_PATH = './src/data/photos.json';

const UPLOAD = process.argv.includes('--upload');
const VALIDATE = process.argv.includes('--validate');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function parseFilename(name) {
  const m = name.match(/^(.+)_(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m) {
    const [, titlePart, day, month, year] = m;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return { title: titlePart.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), date };
  }
  const m2 = name.match(/^_?(\d+)_?(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m2) {
    const [, , day, month, year] = m2;
    return { title: null, date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` };
  }
  return { title: null, date: null };
}

async function validateNewPhotos() {
  const srcDir = join(process.cwd(), PHOTOS_DIR);
  if (!existsSync(srcDir)) return;

  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(await readFile(join(process.cwd(), MANIFEST_PATH), 'utf-8'))
    : [];
  const existingSlugs = new Set(manifest.map(p => p.slug));

  const files = (await readdir(srcDir)).filter(f => /\.jpe?g$/i.test(f));
  let valid = 0, invalid = 0;

  console.log(`\nValidating ${files.length} source JPGs...\n`);

  for (const file of files) {
    const slug = slugify(parse(file).name);
    if (existingSlugs.has(slug)) continue; // already in manifest, skip

    const filePath = join(srcDir, file);
    const issues = [];

    let exif = {};
    try {
      exif = await exifr.parse(filePath, true);
    } catch {
      issues.push('unreadable EXIF');
    }

    // Validate filename structure
    const parsed = parseFilename(parse(file).name);
    if (!parsed.date) issues.push('filename missing date pattern (title_DD_MM_YYYY)');

    // Validate date
    const date = parsed.date || (exif?.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toISOString().slice(0, 10) : null);
    if (!date) issues.push('missing date');

    // Validate GPS
    const lat = exif?.latitude;
    const lng = exif?.longitude;
    if (lat == null || lng == null) issues.push('missing GPS coordinates');

    // Validate camera
    const make = exif?.Make || '';
    const model = exif?.Model || '';
    const camera = [make, model].filter(Boolean).join(' ').trim();
    if (!camera) issues.push('missing camera make/model');

    // Validate image dimensions
    try {
      const meta = await sharp(filePath).metadata();
      if (!meta.width || !meta.height) issues.push('unable to read image dimensions');
    } catch {
      issues.push('unable to open image');
    }

    if (issues.length === 0) {
      console.log(`  ✓ ${file}`);
      valid++;
    } else {
      console.log(`  ✗ ${file}: ${issues.join(', ')}`);
      invalid++;
    }
  }

  console.log(`\nValidation complete: ${valid} valid, ${invalid} with issues`);
  return invalid === 0;
}

async function generateMissingMedia() {
  const manifestPath = join(process.cwd(), MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    console.log('No manifest found, nothing to generate.');
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  console.log(`\nChecking ${manifest.length} manifest entries for missing media...`);

  await mkdir(join(process.cwd(), PUBLIC_PHOTOS), { recursive: true });
  await mkdir(join(process.cwd(), PUBLIC_THUMBS), { recursive: true });

  let generated = 0;

  for (const photo of manifest) {
    const fullPath = join(process.cwd(), PUBLIC_PHOTOS, `${photo.slug}.webp`);
    const thumbPath = join(process.cwd(), PUBLIC_THUMBS, `${photo.slug}.webp`);
    const missingFull = !existsSync(fullPath);
    const missingThumb = !existsSync(thumbPath);

    if (!missingFull && !missingThumb) continue;

    const srcName = photo.slug.replace(/-/g, '_');
    let srcFile = null;
    const srcDir = join(process.cwd(), PHOTOS_DIR);
    if (existsSync(srcDir)) {
      const entries = await readdir(srcDir);
      const match = entries.find(e => e.startsWith(srcName) && /\.jpe?g$/i.test(e));
      if (match) srcFile = join(srcDir, match);
    }

    if (!srcFile) {
      console.log(`  ✗ ${photo.slug} — source JPG not found, skipping`);
      continue;
    }

    try {
      const image = sharp(srcFile);

      if (missingFull) {
        console.log(`  → generating fullsize: ${photo.slug}.webp`);
        await image
          .clone()
          .resize(2000, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(fullPath);
      }

      if (missingThumb) {
        console.log(`  → generating thumbnail: ${photo.slug}.webp`);
        await image
          .clone()
          .resize(500, undefined, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(thumbPath);
      }

      generated++;

      if (UPLOAD) {
        console.log(`  → uploading to R2: ${photo.slug}`);
      }
    } catch (err) {
      console.error(`  ✗ ${photo.slug} — failed: ${err.message}`);
    }
  }

  console.log(`\nMedia generation complete. Generated ${generated} files.`);
  if (UPLOAD) console.log('Upload flag set — implement R2 upload command above.');
}

async function main() {
  if (VALIDATE) {
    const ok = await validateNewPhotos();
    if (!ok) process.exit(1);
  }

  await generateMissingMedia();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
