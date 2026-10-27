/** Octets par pixel dans des données RGBA. */
const RGBA_STRIDE = 4;
/** Coefficients de luminance (Rec. 601). */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const MAX_LEVEL = 255;
/** Taille des blocs comparés (px, sur l'image réduite 64 × 36). */
const BLOCK_WIDTH = 16;
const BLOCK_HEIGHT = 12;
/** Déplacement maximal (px) recherché pour chaque bloc : absorbe mouvements de caméra et de sujet. */
const SEARCH_RADIUS = 4;

export interface CutDetectionOptions {
  /** Nombre de MAD au-dessus de la médiane locale pour qu'une différence compte comme coupe. */
  k?: number;
  /** Écart minimal (s) entre deux coupes : un pic doit dominer ses voisins dans cette fenêtre. */
  minGapSec?: number;
  /** Plancher absolu de différence, pour ignorer les extraits sans aucune coupe. */
  minDiff?: number;
}

/** Coefficient k par défaut (meilleur compromis mesuré), et bornes du curseur de sensibilité. */
export const DEFAULT_K = 4;
export const MIN_K = 1;
export const MAX_K = 6;
const DEFAULT_MIN_GAP_SEC = 0.2;
export const DEFAULT_MIN_DIFF = 0.04;
/** Demi-fenêtre (s) du seuil local : environ 2 s de contexte autour de chaque image. */
const LOCAL_WINDOW_SEC = 1;
/** Voisins immédiats exclus du contexte local (une coupe ne doit pas relever son propre seuil). */
const EXCLUDED_NEIGHBORS = 1;
/** MAD minimale : sur un plan fixe la MAD est quasi nulle et rendrait tout pic significatif. */
const MIN_DEVIATION = 0.02;
/** Médiane locale sous laquelle le plan est considéré comme fixe. */
const STILL_SHOT_LEVEL = 0.03;
/** Sur plan fixe, un voisin au moins aussi fort que cette fraction du pic signale une image isolée (artefact). */
const ARTIFACT_NEIGHBOR_RATIO = 0.6;

/** Luminance de chaque pixel d'une image RGBA. */
function luminance(data: Uint8ClampedArray): Float32Array {
  const pixelCount = Math.floor(data.length / RGBA_STRIDE);
  const luma = new Float32Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const i = p * RGBA_STRIDE;
    luma[p] = LUMA_R * data[i] + LUMA_G * data[i + 1] + LUMA_B * data[i + 2];
  }
  return luma;
}

/** Plus petite différence absolue moyenne entre un bloc de `b` et ce bloc déplacé d'au plus SEARCH_RADIUS dans `a`. */
function bestBlockMatch(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  block: { x: number; y: number; w: number; h: number },
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
    if (block.y + dy < 0 || block.y + dy + block.h > height) continue;
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      if (block.x + dx < 0 || block.x + dx + block.w > width) continue;
      let sum = 0;
      for (let y = block.y; y < block.y + block.h; y++) {
        const row = y * width;
        const shifted = (y + dy) * width + dx;
        for (let x = block.x; x < block.x + block.w; x++) sum += Math.abs(b[row + x] - a[shifted + x]);
      }
      best = Math.min(best, sum);
    }
  }
  return best / (block.w * block.h);
}

/**
 * Différence entre deux images RGBA de même taille (`width` px de large), dans [0, 1] :
 * moyenne, sur des blocs de 16 × 12 px, de l'écart de luminance après recalage de chaque
 * bloc (±4 px). Le recalage absorbe les mouvements ; une coupe change le contenu de tous les blocs.
 */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  const pixelCount = Math.min(la.length, lb.length);
  if (pixelCount === 0) return 0;
  const w = width > 0 && width <= pixelCount ? Math.floor(width) : pixelCount;
  const h = Math.floor(pixelCount / w);
  let total = 0;
  let blocks = 0;
  for (let y = 0; y < h; y += BLOCK_HEIGHT) {
    for (let x = 0; x < w; x += BLOCK_WIDTH) {
      const block = { x, y, w: Math.min(BLOCK_WIDTH, w - x), h: Math.min(BLOCK_HEIGHT, h - y) };
      total += bestBlockMatch(la, lb, w, h, block);
      blocks++;
    }
  }
  return Math.min(1, total / blocks / MAX_LEVEL);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Médiane et MAD des différences autour de l'indice `i` (fenêtre ±`radius`, voisins immédiats exclus). */
function localContext(diffs: number[], i: number, radius: number): { level: number; deviation: number } {
  const around: number[] = [];
  for (let j = Math.max(0, i - radius); j <= Math.min(diffs.length - 1, i + radius); j++) {
    if (Math.abs(j - i) > EXCLUDED_NEIGHBORS) around.push(diffs[j]);
  }
  const level = median(around);
  return { level, deviation: median(around.map((d) => Math.abs(d - level))) };
}

/**
 * Seuil de coupe de chaque différence : médiane locale + k·MAD (MAD jamais sous
 * MIN_DEVIATION), jamais sous `minDiff`. Seuil adaptatif : élevé dans les scènes
 * agitées, bas sur les plans calmes.
 */
export function cutThresholds(diffs: number[], fps: number, k = DEFAULT_K, minDiff = DEFAULT_MIN_DIFF): number[] {
  const radius = Math.max(EXCLUDED_NEIGHBORS + 1, Math.round(LOCAL_WINDOW_SEC * fps));
  return diffs.map((_, i) => {
    const { level, deviation } = localContext(diffs, i, radius);
    return Math.max(minDiff, level + k * Math.max(deviation, MIN_DEVIATION));
  });
}

/** Moyenne et écart-type des différences (0 pour un tableau vide). */
export function diffStatistics(diffs: number[]): { mean: number; deviation: number } {
  if (diffs.length === 0) return { mean: 0, deviation: 0 };
  const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  const variance = diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / diffs.length;
  return { mean, deviation: Math.sqrt(variance) };
}

/** Vrai si `diffs[i]` est le maximum strict de sa fenêtre ±`gap` (premier en cas d'égalité). */
function dominatesNeighbors(diffs: number[], i: number, gap: number): boolean {
  for (let j = Math.max(0, i - gap); j <= Math.min(diffs.length - 1, i + gap); j++) {
    if (j === i) continue;
    if (diffs[j] > diffs[i] || (diffs[j] === diffs[i] && j < i)) return false;
  }
  return true;
}

/**
 * Image isolée sur plan fixe (artefact d'encodage, flash) : le pic et un voisin
 * comparable encadrent une seule image, et les différences de part et d'autre de
 * ce couple reviennent aussitôt au niveau calme du plan.
 */
function isStillShotArtifact(diffs: number[], i: number, level: number): boolean {
  if (level >= STILL_SHOT_LEVEL) return false;
  const before = diffs[i - 1] ?? 0;
  const after = diffs[i + 1] ?? 0;
  const partner = Math.max(before, after);
  if (partner < ARTIFACT_NEIGHBOR_RATIO * diffs[i]) return false;
  const flanks = after >= before ? [before, diffs[i + 2] ?? 0] : [diffs[i - 2] ?? 0, after];
  return Math.max(...flanks) <= level + MIN_DEVIATION;
}

/**
 * Temps des coupes (s) à partir des différences entre images successives
 * (`diffs[i]` = différence entre l'image i et i+1). Une coupe est un pic qui
 * domine ses voisins sur ±`minGapSec`, dépasse le seuil local (voir `cutThresholds`)
 * et n'est pas une image isolée sur plan fixe. Plus k est petit, plus il y a de coupes.
 */
export function detectCuts(diffs: number[], fps: number, options: CutDetectionOptions = {}): number[] {
  if (diffs.length === 0 || !(fps > 0)) return [];
  const gap = Math.max(1, Math.round((options.minGapSec ?? DEFAULT_MIN_GAP_SEC) * fps));
  const radius = Math.max(EXCLUDED_NEIGHBORS + 1, Math.round(LOCAL_WINDOW_SEC * fps));
  const thresholds = cutThresholds(diffs, fps, options.k, options.minDiff);

  const cuts: number[] = [];
  diffs.forEach((diff, i) => {
    if (diff < thresholds[i] || !dominatesNeighbors(diffs, i, gap)) return;
    if (isStillShotArtifact(diffs, i, localContext(diffs, i, radius).level)) return;
    cuts.push((i + 1) / fps);
  });
  return cuts;
}
