#!/usr/bin/env node

import { readFile, writeFile, readdir, mkdir, unlink, rename } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
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
const NO_COMMIT = process.argv.includes('--no-commit');
const NO_PRUNE = process.argv.includes('--no-prune');
const FORCE_PRUNE = process.argv.includes('--force-prune');

// Deleting from the bucket is irreversible, so anything above this many objects has
// to be confirmed explicitly rather than pruned on a hunch.
const MAX_PRUNE = 100;

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
  const objects = new Map();
  let token;
  do {
    const res = await getR2Client().send(
      new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) objects.set(obj.Key, obj.Size ?? null);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects;
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

async function deleteFromR2(keys) {
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const res = await getR2Client().send(
      new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true },
      }),
    );
    for (const err of res.Errors || []) console.warn(`    ✗ ${err.Key}: ${err.Message}`);
    deleted += chunk.length - (res.Errors?.length || 0);
  }
  return deleted;
}

// Objects under our two prefixes that no longer correspond to a photo in the manifest.
async function pruneR2(manifestSlugs, r2Photos, r2Thumbs) {
  const orphaned = objects =>
    [...objects.keys()].filter(key => key.endsWith('.webp') && !manifestSlugs.has(parse(key).name));

  const keys = [...orphaned(r2Photos), ...orphaned(r2Thumbs)];

  if (!keys.length) {
    console.log('\nNothing to prune on R2.');
    return;
  }

  console.log(`\nPruning ${keys.length} orphaned object(s) from R2:`);
  for (const key of keys) console.log(`  - ${key}`);

  if (keys.length > MAX_PRUNE && !FORCE_PRUNE) {
    console.warn(
      `\nRefusing to delete ${keys.length} objects (limit is ${MAX_PRUNE}). ` +
        `Re-run with --force-prune if this is expected.`,
    );
    return;
  }

  const deleted = await deleteFromR2(keys);
  console.log(`\nDeleted ${deleted} object(s) from R2.`);
}

async function validateJPGs(files) {
  const srcDir = join(process.cwd(), PHOTOS_DIR);
  console.log(`\nValidating ${files.length} source JPGs...\n`);
  let valid = 0,
    invalid = 0;

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

async function reverseGeocode(lat, lng) {
  const https = await import('node:https');
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=3`;
  return new Promise(resolve => {
    https
      .get(url, { headers: { 'User-Agent': 'portfolio-process/1.0' } }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed?.address?.country || null);
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
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
    execFile('exiftool', args, err => {
      if (err) resolve(false);
      else resolve(true);
    });
  });
}

async function hashFile(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function fileSize(filePath) {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

// True when the object on R2 is missing or doesn't match what we just generated.
function staleRemote(localPath, key, remoteObjects) {
  if (!remoteObjects.has(key)) return true;
  const localSize = fileSize(localPath);
  const remoteSize = remoteObjects.get(key);
  if (localSize == null || remoteSize == null) return false;
  return localSize !== remoteSize;
}

// Recording or refreshing the source hash isn't a change to the photo itself, so it
// shouldn't count as an update in the summary.
const photoFields = ({ sourceHash, ...rest }) => JSON.stringify(rest);

function execGit(args) {
  return new Promise(resolve => {
    execFile('git', args, { cwd: process.cwd() }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function commitManifest({ newCount, changedCount, updatedCount }) {
  const manifest = 'src/data/photos.json';

  if (NO_COMMIT) {
    console.log('\nSkipping commit (--no-commit).');
    return;
  }

  const status = await execGit(['status', '--porcelain', '--', manifest]);
  if (status.code !== 0) {
    console.warn(`\nCould not read git status, skipping commit: ${status.stderr}`);
    return;
  }
  if (!status.stdout) {
    console.log('\nManifest unchanged, nothing to commit.');
    return;
  }

  const parts = [];
  if (newCount) parts.push(`${newCount} new`);
  if (changedCount) parts.push(`${changedCount} changed`);
  if (updatedCount) parts.push(`${updatedCount} updated`);
  const summary = parts.length ? ` (${parts.join(', ')})` : '';
  const message = `chore(photos): sync photo manifest${summary}`;

  const commit = await execGit(['commit', '-m', message, '--', manifest]);
  if (commit.code !== 0) {
    console.warn(`\nCommit failed, changes left unstaged: ${commit.stderr || commit.stdout}`);
    return;
  }

  const head = await execGit(['log', '-1', '--format=%h %s']);
  console.log(`\nCommitted ${manifest} → ${head.stdout}`);
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
    console.error(`Missing ${PHOTOS_DIR}`);
    process.exit(1);
  }

  const files = (await readdir(srcDir)).filter(f => /\.jpe?g$/i.test(f));
  if (!files.length) {
    console.log('No JPGs found in photos_to_process/.');
    return;
  }

  const { invalid } = await validateJPGs(files);
  if (VALIDATE_ONLY) {
    rl.close();
    process.exit(invalid ? 1 : 0);
  }
  if (invalid) {
    console.warn(`${invalid} file(s) have issues — will prompt for missing data\n`);
  }

  let r2Photos = new Map();
  let r2Thumbs = new Map();
  const upload = !NO_UPLOAD;
  if (upload) {
    console.log('Listing existing R2 objects for diff...');
    const [photoObjects, thumbObjects] = await Promise.all([
      listR2Objects(R2_PHOTO_PREFIX),
      listR2Objects(R2_THUMB_PREFIX),
    ]);
    r2Photos = photoObjects;
    r2Thumbs = thumbObjects;
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
  let generated = 0,
    uploaded = 0,
    skipped = 0,
    newCount = 0,
    changedCount = 0,
    updatedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let filePath = join(srcDir, file);
    let slug = slugify(parse(file).name);
    const prev = existing[slug] || {};
    const isNew = !existing[slug];
    const idx = `[${i + 1}/${files.length}]`;

    let exif = {};
    try {
      exif = await exifr.parse(filePath, true);
    } catch {}

    if (isNew) {
      const exifDate = exif?.DateTimeOriginal ? new Date(exif.DateTimeOriginal) : null;
      const parsedOrig = parseFilename(file);
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
      }
      await promptForMissing(filePath, slug, exif);
      try {
        exif = await exifr.parse(filePath, true);
      } catch {}
    }

    let category = prev.category || 'uncategorized';
    if (isNew) {
      const catAns = await ask('    category: ');
      const trimmed = catAns.trim();
      if (trimmed) category = trimmed;
    }

    const parsed = parseFilename(filePath);
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

    if (isNew && (!date || lat == null || lng == null || !camera)) {
      console.log(`  ${idx} ✗ ${slug} — still missing required data after prompt, skipping`);
      skipped++;
      continue;
    }

    try {
      // Fingerprint the source before anything else. exiftool may have rewritten it
      // during the prompt above, so this has to happen after that, not before.
      const sourceHash = await hashFile(filePath);

      const image = sharp(filePath);
      const meta = await image.metadata();
      const imgWidth = exif?.ExifImageWidth || meta.width || 0;
      const imgHeight = exif?.ExifImageHeight || meta.height || 0;

      const fullPath = join(process.cwd(), PUBLIC_PHOTOS, `${slug}.webp`);
      const thumbPath = join(process.cwd(), PUBLIC_THUMBS, `${slug}.webp`);

      // A source can be swapped in place, or deleted and re-added under the same
      // name — the slug stays put, so file existence proves nothing. Compare the
      // hash recorded when this manifest entry was written instead.
      let sourceChanged;
      if (isNew) {
        sourceChanged = true;
      } else if (prev.sourceHash) {
        sourceChanged = prev.sourceHash !== sourceHash;
      } else {
        // Entry predates sourceHash. Fall back to comparing the local WebP against
        // the object already on R2 — if they disagree the remote copy is stale.
        const [localSize, remoteSize] = [
          fileSize(fullPath),
          r2Photos.get(`${R2_PHOTO_PREFIX}${slug}.webp`) ?? null,
        ];
        sourceChanged = localSize != null && remoteSize != null && localSize !== remoteSize;
      }

      const needsFull = !existsSync(fullPath) || sourceChanged;
      const needsThumb = !existsSync(thumbPath) || sourceChanged;

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

      const photoKey = `${R2_PHOTO_PREFIX}${slug}.webp`;
      const thumbKey = `${R2_THUMB_PREFIX}${slug}.webp`;
      const photoStale = staleRemote(fullPath, photoKey, r2Photos);
      const thumbStale = staleRemote(thumbPath, thumbKey, r2Thumbs);

      if (upload && (FORCE || photoStale)) {
        await uploadToR2(fullPath, photoKey);
        uploaded++;
      }
      if (upload && (FORCE || thumbStale)) {
        await uploadToR2(thumbPath, thumbKey);
        uploaded++;
      }

      let location = null;
      if (lat != null && lng != null) {
        location = { lat, lng };
      }

      let country = prev.country ?? null;
      if (isNew && lat != null && lng != null && !country) {
        country = await reverseGeocode(lat, lng);
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
      entry.category = category;
      entry.iso = iso;
      entry.aperture = aperture;
      entry.focalLength = focalLength;
      entry.shutterSpeed = shutterSpeed;
      entry.country = country;
      entry.sourceHash = sourceHash;
      photos.push(entry);

      if (isNew) newCount++;
      else if (sourceChanged) changedCount++;
      else if (photoFields(entry) !== photoFields(prev)) updatedCount++;

      const status = [];
      if (isNew) status.push('new');
      else if (sourceChanged) status.push('changed');
      if (needsFull) status.push('fullsize');
      if (needsThumb) status.push('thumb');
      if (upload && photoStale) status.push('uploaded');
      if (upload && thumbStale) status.push('thumb uploaded');
      console.log(
        `  ${idx} ${status.length ? '→' : '✓'} ${slug}${status.length ? ` (${status.join(', ')})` : ''}`,
      );
    } catch (err) {
      console.error(`  ${idx} ✗ ${slug}: ${err.message}`);
      skipped++;
    }
  }

  photos.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.slug.localeCompare(b.slug));
  await writeFile(join(process.cwd(), MANIFEST_PATH), JSON.stringify(photos, null, 2) + '\n');

  console.log(
    `\nDone: ${photos.length} in manifest, ${generated} generated, ${uploaded} uploaded to R2, ${skipped} skipped`,
  );

  if (upload) {
    if (NO_PRUNE) {
      console.log('\nSkipping R2 prune (--no-prune).');
    } else {
      const manifestSlugs = new Set(photos.map(p => p.slug));
      try {
        await pruneR2(manifestSlugs, r2Photos, r2Thumbs);
      } catch (err) {
        console.warn(`\nPrune failed, nothing deleted: ${err.message}`);
      }
    }
  }

  await commitManifest({ newCount, changedCount, updatedCount });

  rl.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
