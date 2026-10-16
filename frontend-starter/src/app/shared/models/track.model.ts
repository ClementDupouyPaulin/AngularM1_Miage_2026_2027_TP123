/** Origine de la pochette : fichier envoyé, tag ID3 embarqué ou recherche Web. */
export type CoverSource = 'upload' | 'id3' | 'web';

/** Audio track metadata returned by the API. */
export interface Track {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  artist: string | null;
  album: string | null;
  hasCover: boolean;
  coverSource: CoverSource | null;
}
