# photo portfolio

Astro-based photo portfolio. Images are served from Cloudflare R2 in production and from local `public/` in development.

## setup

```bash
cp .env.example .env   # fill in R2 credentials
npm install
```

## scripts

### `npm run sync`

Validates, generates, and uploads — the one command. Lists existing R2 objects, compares against local sources, validates EXIF, generates missing WebP files, and uploads only the diff.

```bash
# full pipeline: validate → generate missing → upload new files to R2
npm run sync

# validate only (exit 1 if anything fails)
npm run sync -- --validate-only

# generate WebP and update manifest, skip R2 upload
npm run sync -- --no-upload

# force re-upload even if file exists on R2
npm run sync -- --force
```

### `npm run sync` (interactive)

For new files, `sync` runs interactively — prompts to rename, fills missing EXIF (date, GPS, camera), and asks for a category before generating WebP and uploading to R2. Existing files are processed silently.

```bash
npm run sync           # default: uploads to R2
npm run sync -- --no-upload   # local only, skip R2
npm run sync -- --force       # re-upload even if present on R2
```

### `npm run discover`

Scans R2 buckets and rebuilds `src/data/photos.json` from remote files. Useful for disaster recovery or bootstrapping from R2.

```bash
npm run discover
```

Requires `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_URL` in `.env`.

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
