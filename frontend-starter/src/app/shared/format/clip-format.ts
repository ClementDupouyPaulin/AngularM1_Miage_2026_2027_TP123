import { SYNC_ALIGNED_THRESHOLD } from '../analysis/sync-score';
import { ClipVisibility } from '../models/clip.model';

const SECONDS_PER_MINUTE = 60;
const SYNC_SCORE_DIGITS = 2;
const MISSING_VALUE = '—';

export interface SyncInterpretation {
  value: string;
  verdict: string;
}

export const VISIBILITY_LABELS: Readonly<Record<ClipVisibility, string>> = {
  private: 'Privé',
  shared: 'Partagé avec des amis',
  public: 'Public',
};

const DECIMAL_FORMATS = new Map<number, Intl.NumberFormat>();

/** Nombre décimal à la française (virgule), avec exactement `digits` décimales. */
export function formatDecimal(value: number, digits: number): string {
  let format = DECIMAL_FORMATS.get(digits);
  if (!format) {
    format = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    DECIMAL_FORMATS.set(digits, format);
  }
  return format.format(value);
}

/** Durée en `m:ss`. */
export function formatDuration(totalSec: number): string {
  const seconds = Math.max(0, Math.round(Number.isFinite(totalSec) ? totalSec : 0));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function hasScore(score: number | null): score is number {
  return score !== null && Number.isFinite(score);
}

export function isSynced(score: number | null): boolean {
  return hasScore(score) && score >= SYNC_ALIGNED_THRESHOLD;
}

/** Score de synchro affiché partout sous la forme « × 1,27 » ; « — » s'il est absent. */
export function formatSyncScore(score: number | null): string {
  return hasScore(score) ? `× ${formatDecimal(score, SYNC_SCORE_DIGITS)}` : MISSING_VALUE;
}

/** Libellé du score de synchro : ≈ 1 sans lien, > 1 calé, `null` non analysable. */
export function interpretSyncScore(score: number | null): SyncInterpretation {
  if (!hasScore(score)) return { value: MISSING_VALUE, verdict: 'Bande-son non analysable' };
  const value = formatSyncScore(score);
  return isSynced(score)
    ? { value, verdict: 'Calé sur la musique' }
    : { value, verdict: 'Sans lien avec la musique' };
}

/** Verdict en minuscules, pour s'insérer dans une phrase. */
export function syncScoreLabel(score: number | null): string {
  return interpretSyncScore(score).verdict.toLocaleLowerCase('fr-FR');
}
