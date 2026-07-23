export interface PhotoLocation {
  lat: number;
  lng: number;
}

export interface Photo {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  location: PhotoLocation | null;
  country?: string;
  date: string;
  camera: string;
  thumbnail: string;
  fullsize: string;
  width: number;
  height: number;
  iso?: number | null;
  aperture?: string | null;
  focalLength?: string | null;
  shutterSpeed?: string | null;
}

export interface PhotoManifest {
  photos: Photo[];
}
