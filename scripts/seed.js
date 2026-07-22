import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const COUNT = 24;
const WIDTHS = [1200, 1400, 1600, 1800, 2000];
const HEIGHTS = [800, 900, 1000, 1100, 1200, 1300, 1400];
const CATEGORIES = ['landscape', 'portrait', 'street', 'travel', 'architecture', 'nature'];

const LOCATIONS = [
  { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503 },
  { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
  { name: 'Reykjavík, Iceland', lat: 64.1466, lng: -21.9426 },
  { name: 'Marrakech, Morocco', lat: 31.6295, lng: -7.9811 },
  { name: 'New York, USA', lat: 40.7128, lng: -74.006 },
  { name: 'Cape Town, South Africa', lat: -33.9249, lng: 18.4241 },
  { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093 },
  { name: 'Bali, Indonesia', lat: -8.3405, lng: 115.092 },
  { name: 'Patagonia, Chile', lat: -51.5007, lng: -72.5068 },
  { name: 'Santorini, Greece', lat: 36.3932, lng: 25.4615 },
  { name: 'San Francisco, USA', lat: 37.7749, lng: -122.4194 },
  { name: 'Kyoto, Japan', lat: 35.0116, lng: 135.7681 },
  { name: 'Amalfi Coast, Italy', lat: 40.6333, lng: 14.6 },
  { name: 'Banff, Canada', lat: 51.1784, lng: -115.5708 },
  { name: 'Hong Kong', lat: 22.3193, lng: 114.1694 },
  { name: 'Lisbon, Portugal', lat: 38.7223, lng: -9.1393 },
];

const CAMERAS = [
  'Sony A7III',
  'Fujifilm X-T5',
  'Leica M11',
  'Nikon Z8',
  'Canon R5',
  'Hasselblad X2D',
];

const TAGS_BY_CATEGORY = {
  landscape: ['mountains', 'ocean', 'sunset', 'forest', 'lake', 'valley', 'horizon'],
  portrait: ['people', 'candid', 'natural-light', 'street-style', 'urban'],
  street: ['city', 'night', 'neon', 'architecture', 'urban', 'pedestrians'],
  travel: ['culture', 'wanderlust', 'exploring', 'local', 'landmark', 'adventure'],
  architecture: ['modern', 'historic', 'minimal', 'facade', 'interior', 'geometric'],
  nature: ['wildlife', 'flora', 'macro', 'river', 'waterfall', 'trees', 'flowers'],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

const TITLES = [
  'Golden Hour Serenity',
  'Urban Pulse',
  'Silent Morning',
  'Endless Horizon',
  'Shadows & Light',
  'Coastal Dream',
  'City Reflections',
  'Mountain Solitude',
  'Twilight Glow',
  'Wanderer',
  'Neon Nights',
  'Forest Canopy',
  'Tidal Pools',
  'Summit View',
  'Harbor Lights',
  'Desert Bloom',
  'Cobblestone Tales',
  'Azure Depths',
  'Verdant Path',
  'Concrete Jungle',
  'Peak Clarity',
  'Midnight Blue',
  'Rustic Charm',
  'Open Road',
];

async function seed() {
  const rng = seededRandom(42);
  const photos = [];

  for (let i = 0; i < COUNT; i++) {
    const w = pick(WIDTHS);
    const h = pick(HEIGHTS);
    const category = CATEGORIES[i % CATEGORIES.length];
    const location = LOCATIONS[i % LOCATIONS.length];
    const camera = pick(CAMERAS);
    const title = TITLES[i];

    const seedStr = `portfolio-${i}-${title.toLowerCase().replace(/\s+/g, '-')}`;
    const tags = [pick(TAGS_BY_CATEGORY[category])];
    if (rng() > 0.5) tags.push(pick(TAGS_BY_CATEGORY[category]));
    if (rng() > 0.6) tags.push(pick(TAGS_BY_CATEGORY[category]));

    const date = new Date(2024, Math.floor(i / 2) % 12, ((i * 7) % 28) + 1);

    photos.push({
      slug: title.toLowerCase().replace(/\s+/g, '-').replace(/&/g, 'and'),
      title,
      description: '',
      category,
      tags: [...new Set(tags)],
      location: rng() > 0.15 ? { ...location } : null,
      date: formatDate(date),
      camera,
      thumbnail: `https://picsum.photos/seed/${seedStr}/500/${Math.round(h * (500 / w))}`,
      fullsize: `https://picsum.photos/seed/${seedStr}/${w}/${h}`,
      width: w,
      height: h,
    });
  }

  const manifestPath = join(process.cwd(), 'src', 'data', 'photos.json');
  const seedDir = join(process.cwd(), 'photos_to_process');
  if (!existsSync(seedDir)) {
    await mkdir(seedDir, { recursive: true });
  }

  await writeFile(manifestPath, JSON.stringify(photos, null, 2));
  console.log(`Generated ${COUNT} placeholder photos -> src/data/photos.json`);
  console.log('Images served from picsum.photos - no R2 upload needed for testing.');
  console.log('Run `npm run dev` to preview.');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
