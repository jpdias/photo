export interface PhotoLocation {
  lat: number;
  lng: number;
  name: string;
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
}

export interface PhotoManifest {
  photos: Photo[];
}
