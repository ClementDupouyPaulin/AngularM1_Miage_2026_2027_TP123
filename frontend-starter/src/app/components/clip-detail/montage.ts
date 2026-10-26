import { SYNC_ALIGNED_THRESHOLD } from '../../shared/analysis/sync-score';
import { ClipAnnotation, ClipVisibility } from '../../shared/models/clip.model';

/**
 * Marge de « Coupe précédente » : pendant la lecture, juste après une coupe,
 * un nouvel appui doit remonter à la coupe d'avant et non rester sur place.
 */
export const PREVIOUS_CUT_MARGIN_SEC = 0.5;
/** Tolérance de « Coupe suivante » : ignore la coupe sur laquelle on vient de sauter. */
const NEXT_CUT_EPSILON_SEC = 0.05;

export const ANNOTATION_MAX_LENGTH = 280;
export const TAG_MAX_COUNT = 5;
export const TAG_MAX_LENGTH = 24;
export const TITLE_MAX_LENGTH = 200;

export interface SyncInterpretation {
  value: string;
  verdict: string;
}

export const VISIBILITY_LABELS: Readonly<Record<ClipVisibility, string>> = {
  private: 'Privé',
  shared: 'Partagé avec des amis',
  public: 'Public',
};

export function formatDecimal(value: number, digits: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Libellé du score de synchro : ≈ 1 sans lien, > 1 calé, `null` non analysable. */
export function interpretSyncScore(score: number | null): SyncInterpretation {
  if (score === null || !Number.isFinite(score)) {
    return { value: '—', verdict: 'Bande-son non analysable' };
  }
  const value = `× ${formatDecimal(score, 2)}`;
  return score >= SYNC_ALIGNED_THRESHOLD
    ? { value, verdict: 'Calé sur la musique' }
    : { value, verdict: 'Sans lien avec la musique' };
}

/** Dernière coupe strictement avant `time - margin`, sinon `null`. */
export function previousCut(cuts: readonly number[], time: number, margin = PREVIOUS_CUT_MARGIN_SEC): number | null {
  let found: number | null = null;
  for (const cut of cuts) {
    if (cut < time - margin) found = cut;
    else break;
  }
  return found;
}

/** Première coupe après `time`, sinon `null`. */
export function nextCut(cuts: readonly number[], time: number): number | null {
  return cuts.find((cut) => cut > time + NEXT_CUT_EPSILON_SEC) ?? null;
}

/**
 * Compare le tempo de la musique à la cadence du montage : combien de temps
 * musicaux s'écoulent en moyenne entre deux coupes.
 */
export function tempoComparison(bpm: number | null, cutsPerMinute: number): string {
  if (bpm === null) return 'Tempo non mesurable (moins de 4 beats)';
  if (!(cutsPerMinute > 0)) return 'Aucune coupe à comparer';
  const beatsPerCut = bpm / cutsPerMinute;
  return `≈ 1 coupe tous les ${formatDecimal(beatsPerCut, 1)} temps (${formatDecimal(cutsPerMinute, 1)} coupes/min)`;
}

/** Annotations triées par instant puis par date de création. */
export function sortAnnotations(annotations: readonly ClipAnnotation[]): ClipAnnotation[] {
  return [...annotations].sort((a, b) => a.time - b.time || a.createdAt.localeCompare(b.createdAt));
}

/** Étiquettes saisies séparées par des virgules : rognées, minuscules, sans doublon. */
export function parseTags(raw: string): string[] {
  const tags = raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)];
}

/** Message d'erreur des étiquettes, ou `null` si la liste respecte le contrat. */
export function tagsError(tags: readonly string[]): string | null {
  if (tags.length > TAG_MAX_COUNT) return `${TAG_MAX_COUNT} étiquettes maximum.`;
  if (tags.some((tag) => tag.length > TAG_MAX_LENGTH)) return `Une étiquette fait ${TAG_MAX_LENGTH} caractères au plus.`;
  return null;
}

/** Instant d'annotation arrondi au dixième et borné à la durée du clip. */
export function annotationTime(time: number, durationSec: number): number {
  const bounded = Math.min(Math.max(0, Number.isFinite(time) ? time : 0), Math.max(0, durationSec));
  return Math.floor(bounded * 10) / 10;
}
