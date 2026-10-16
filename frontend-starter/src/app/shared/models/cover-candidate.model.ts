/** Pochette proposée par la recherche Web (`GET /api/tracks/:id/cover/search`). */
export interface CoverCandidate {
  id: string;
  title: string;
  artist: string;
  album: string;
  imageUrl: string;
}
