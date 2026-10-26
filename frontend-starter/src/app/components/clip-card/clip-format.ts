import { SYNC_ALIGNED_THRESHOLD } from '../../shared/analysis/sync-score';
import { ClipVisibility } from '../../shared/models/clip.model';

const SECONDS_PER_MINUTE = 60;

export const VISIBILITY_LABELS: Readonly<Record<ClipVisibility, string>> = {
  private: 'Privé',
  shared: 'Amis',
  public: 'Public',
};

export function isSynced(score: number | null): boolean {
  return score !== null && score >= SYNC_ALIGNED_THRESHOLD;
}

/** Libellé lisible du score de synchronisation coupes/musique. */
export function syncScoreLabel(score: number | null): string {
  if (score === null) return 'bande-son non analysable';
  return isSynced(score) ? 'calé sur la musique' : 'sans lien avec la musique';
}

/** Durée en `m:ss`. */
export function formatDuration(totalSec: number): string {
  const seconds = Math.max(0, Math.round(Number.isFinite(totalSec) ? totalSec : 0));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/** Nombre décimal à la française (virgule). */
export function formatDecimal(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',');
}
