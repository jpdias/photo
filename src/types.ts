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
  iso?: number;
  aperture?: string;
  focalLength?: string;
  shutterSpeed?: string;
}

export interface PhotoManifest {
  photos: Photo[];
}
