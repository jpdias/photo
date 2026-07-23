#!/usr/bin/env node

/**
 * discover.js — Auto-discover photos from Cloudflare R2, extract EXIF,
 * reverse-geocode GPS, and generate src/data/photos.json.
 *
 * Usage:
 *   node scripts/discover.js
 *
 * Required env vars:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL
 * Optional:
 *   R2_BUCKET_NAME (default: portfolio-photos)
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import exifr from 'exifr';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

// ── Config ──────────────────────────────────────────────────────────────────

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'portfolio-photos';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_URL) {
  console.error(
    'Missing required env vars. Check .env for R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL',
  );
  process.exit(1);
}

const MANIFEST_PATH = join(process.cwd(), 'src', 'data', 'photos.json');
const THUMB_PREFIX = 'thumbnails/';
const PHOTO_PREFIX = 'photography/';
const SUPPORTED_EXT = ['.webp', '.jpg', '.jpeg', '.png', '.avif'];

// ── R2 Client ───────────────────────────────────────────────────────────────

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function listAllObjects(prefix) {
  const keys = [];
  let continuationToken = undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const obj of res.Contents || []) {
      keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function downloadObject(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function getImageDimensions(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return { width: meta.width || 0, height: meta.height || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Reverse Geocoding (Nominatim) ──────────────────────────────────────────

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'portfolio-discover/1.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    // Build a clean name like "Tokyo, Japan" or "Paris, France"
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
    const country = addr.country || '';

    if (city && country) return `${city}, ${country}`;
    if (country) return country;
    return data.display_name?.split(',').slice(0, 2).join(',').trim() || null;
  } catch {
    return null;
  }
}

// ── EXIF Extraction ─────────────────────────────────────────────────────────

async function extractExif(buffer) {
  try {
    const exif = await exifr.parse(buffer, true);
    if (!exif) return {};

    const lat = exif.GPSLatitude ?? exif.latitude;
    const lng = exif.GPSLongitude ?? exif.longitude;

    return {
      date: exif.DateTimeOriginal
        ? new Date(exif.DateTimeOriginal).toISOString().split('T')[0]
        : null,
      camera: [exif.Make, exif.Model].filter(Boolean).join(' ').trim() || null,
      lat: lat ?? null,
      lng: lng ?? null,
      width: exif.ExifImageWidth || exif.ImageWidth || null,
      height: exif.ExifImageHeight || exif.ImageHeight || null,
    };
  } catch {
    return {};
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Listing photos in R2...');

  const photoKeys = await listAllObjects(PHOTO_PREFIX);

  // Filter to supported image files in photos/
  const imageKeys = photoKeys.filter(k => SUPPORTED_EXT.some(ext => k.toLowerCase().endsWith(ext)));

  console.log(`📁 Found ${imageKeys.length} photos in R2`);

  // Load existing manifest to preserve manual edits (title, description, category, tags)
  let existing = {};
  if (existsSync(MANIFEST_PATH)) {
    try {
      const data = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      for (const p of data) existing[p.slug] = p;
    } catch {}
  }

  const photos = [];

  for (let i = 0; i < imageKeys.length; i++) {
    const key = imageKeys[i];
    const filename = key.replace(PHOTO_PREFIX, '');
    const slug = slugify(filename);
    const prev = existing[slug];

    console.log(`\n[${i + 1}/${imageKeys.length}] ${slug}`);

    // Download the full photo for EXIF + dimensions
    console.log(`  ⬇️  downloading for EXIF...`);
    const buffer = await downloadObject(key);

    // Extract EXIF
    const exif = await extractExif(buffer);
    const dims = await getImageDimensions(buffer);

    const lat = exif.lat;
    const lng = exif.lng;

    // Reverse geocode GPS only if no previous location or coords changed
    let locationName = null;
    const coordsChanged =
      prev?.location && (prev.location.lat !== lat || prev.location.lng !== lng);
    const noPrevLocation = !prev?.location && lat != null && lng != null;

    if (coordsChanged || noPrevLocation) {
      if (lat != null && lng != null) {
        console.log(`  🌍 reverse geocoding ${lat.toFixed(4)}, ${lng.toFixed(4)}...`);
        locationName = await reverseGeocode(lat, lng);
        await sleep(1100); // Nominatim rate limit: 1 req/s
      }
    } else if (prev?.location) {
      locationName = prev.location.name;
    }

    // Build photo — merge manual fields from previous manifest
    const photo = {
      slug,
      title: prev?.title || titleFromSlug(slug),
      description: prev?.description || '',
      category: prev?.category || 'uncategorized',
      tags: prev?.tags || [],
      location:
        lat != null && lng != null
          ? {
              name: locationName || prev?.location?.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
              lat,
              lng,
            }
          : null,
      date: exif.date || prev?.date || null,
      camera: exif.camera || prev?.camera || null,
      thumbnail: `${R2_PUBLIC_URL.replace(/\/$/, '')}/${THUMB_PREFIX}${slug}.webp`,
      fullsize: `${R2_PUBLIC_URL.replace(/\/$/, '')}/${PHOTO_PREFIX}${filename}`,
      width: exif.width || dims.width || prev?.width || 0,
      height: exif.height || dims.height || prev?.height || 0,
    };

    photos.push(photo);
    console.log(`  ✅ title: "${photo.title}"`);
    if (photo.location) console.log(`  📍 location: ${photo.location.name}`);
    if (photo.date) console.log(`  📅 date: ${photo.date}`);
    if (photo.camera) console.log(`  📷 camera: ${photo.camera}`);
    console.log(`  📐 ${photo.width}x${photo.height}`);
  }

  // Write manifest
  writeFileSync(MANIFEST_PATH, JSON.stringify(photos, null, 2) + '\n');
  console.log(`\n🎉 Wrote ${photos.length} photos to ${MANIFEST_PATH}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
