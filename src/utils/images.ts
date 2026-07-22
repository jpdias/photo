const R2_BASE = import.meta.env.PUBLIC_R2_BASE_URL?.replace(/\/$/, '') || '';

export function imageUrl(localPath: string): string {
  if (!import.meta.env.PROD || !R2_BASE) {
    return localPath;
  }
  const r2Key = localPath
    .replace('/photo/photos/', 'photography/')
    .replace('/photo/thumbnails/', 'thumbnails/');
  return `${R2_BASE}/${r2Key}`;
}
