import { CoverCandidate } from './cover-candidate.model';

/** Réponse de la recherche de pochettes, avec la mention d'attribution à afficher. */
export interface CoverSearchResult {
  query: string;
  source: string;
  attribution: string;
  results: CoverCandidate[];
}
