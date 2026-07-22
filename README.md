# photo portfolio

Astro-based photo portfolio. Images are served from Cloudflare R2 in production and from local `public/` in development.

## setup

```bash
cp .env.example .env   # fill in R2 credentials
npm install
```

## scripts

### `npm run process`

Interactive pipeline: validates JPGs in `photos_to_process/`, extracts EXIF, generates WebP fullsize + thumbnail locally, and appends to `src/data/photos.json`.

```bash
# process all new photos (generates WebP files locally, updates manifest)
npm run process

# process and upload to R2
npm run process -- --upload
```

The `--upload` flag uploads every file in the manifest to R2 (skips existing keys via `HeadObjectCommand`).

### `npm run discover`

Scans R2 buckets, extracts EXIF from remote fullsize images, reverse-geocodes GPS coordinates, and writes `src/data/photos.json`.

```bash
npm run discover
```

Requires `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_URL` in `.env`.

### `npm run sync-media`

Validates and regenerates missing local WebP files from source JPGs in `photos_to_process/`.

```bash
# check manifest entries against local and R2, regenerate missing media
npm run sync-media

# validate dates and metadata in the manifest
npm run sync-media -- --validate
```

### `npm run local-process`

Batch process all JPGs in `photos_to_process/` without interactive prompts. Extracts EXIF, generates WebP files, writes manifest.

```bash
npm run local-process
```

### `npm run seed`

Generates 24 placeholder photos with random metadata for development/testing.

```bash
npm run seed
```

## development

```bash
npm run dev          # astro dev server at localhost:4321
npm run build        # static build to dist/
npm run preview      # preview production build
npm run format       # format with prettier
npm run format:check # check formatting
npm run typecheck    # astro check
```

## deployment

Pushes to `main` trigger GitHub Pages deployment via `.github/workflows/deploy.yml`. The workflow builds the site with `PUBLIC_R2_BASE_URL=https://r2.jpdias.me` and deploys to `https://jpdias.github.io/photo/`.

## R2 structure

```
Bucket: photography
  photography/{slug}.webp   — fullsize images
  thumbnails/{slug}.webp    — 480px thumbnails
```

Public domain: `https://r2.jpdias.me`

## env vars

| Variable               | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `R2_ACCOUNT_ID`        | Cloudflare R2 account ID                                     |
| `R2_ACCESS_KEY_ID`     | R2 API key                                                   |
| `R2_SECRET_ACCESS_KEY` | R2 API secret                                                |
| `R2_BUCKET_NAME`       | R2 bucket (default: `photography`)                           |
| `R2_PUBLIC_URL`        | R2 public endpoint URL                                       |
| `PUBLIC_R2_BASE_URL`   | Public URL for images in production (`https://r2.jpdias.me`) |
| `PHOTOS_DIR`           | Source JPG directory (default: `./photos_to_process`)        |
