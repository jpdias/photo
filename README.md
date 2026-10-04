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

# generate + upload but don't auto-commit the manifest
npm run sync -- --no-commit
```

After a successful run, `sync` commits the updated `src/data/photos.json` (the only tracked file it writes) with a `chore(photos): sync photo manifest (N new, M changed)` message. The commit is path-scoped, so any other staged changes are left alone, and it's skipped entirely when the manifest is unchanged.

### replacing a photo

A source JPG can be deleted and re-added under the same name, or swapped in place. The slug stays the same either way, so `sync` cannot rely on filenames or file existence to notice. Instead it stores a `sourceHash` of each source in the manifest, and treats a changed hash as a reason to regenerate the WebPs and re-upload both the fullsize and thumbnail to R2 (overwriting the existing objects). It also compares the local WebP size against the size of the object on R2, which catches drift on entries written before `sourceHash` existed.

```bash
npm run sync   # re-upload whatever no longer matches its source
```

The same run also prunes objects that no longer correspond to a source photo — see below.

### pruning R2

When a source photo is removed, its objects on R2 are no longer referenced by the manifest. `sync` deletes them (both the fullsize and the thumbnail), so the bucket doesn't accumulate orphans.

```bash
npm run sync                  # upload, then prune orphans
npm run sync -- --no-prune    # upload but keep orphaned objects
npm run sync -- --no-upload   # local only — never touches R2, so never prunes
```

The delete is scoped defensively: only `.webp` keys under the `photography/` and `thumbnails/` prefixes whose slug is absent from the new manifest are eligible, and the whole step is skipped on local-only runs. Because deletion is irreversible, more than 100 objects in one run is refused unless you pass `--force-prune` — a guard against a bad source directory wiping the bucket.

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
