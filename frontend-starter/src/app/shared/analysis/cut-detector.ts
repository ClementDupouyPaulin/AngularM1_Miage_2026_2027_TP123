/** Nombre de classes de l'histogramme, par canal. */
const BINS_PER_CHANNEL = 16;
/** Canaux pris en compte (R, G, B) ; l'alpha est ignoré. */
const COLOR_CHANNELS = 3;
/** Octets par pixel dans des données RGBA. */
const RGBA_STRIDE = 4;
/** Distance L1 maximale entre deux histogrammes normalisés d'un canal. */
const MAX_L1_PER_CHANNEL = 2;

export interface CutDetectionOptions {
  /** Nombre d'écarts-types au-dessus de la moyenne pour qu'une différence compte comme coupe. */
  k?: number;
  /** Écart minimal (s) entre deux coupes ; la plus forte est conservée. */
  minGapSec?: number;
  /** Plancher absolu de différence, pour ignorer les extraits sans aucune coupe. */
  minDiff?: number;
}

const DEFAULT_K = 3;
const DEFAULT_MIN_GAP_SEC = 0.3;
const DEFAULT_MIN_DIFF = 0.2;

/** Histogramme RGB (16 classes par canal), normalisé par le nombre de pixels. */
function colorHistogram(data: Uint8ClampedArray): Float64Array {
  const histogram = new Float64Array(BINS_PER_CHANNEL * COLOR_CHANNELS);
  const pixelCount = Math.floor(data.length / RGBA_STRIDE);
  if (pixelCount === 0) return histogram;
  const binWidth = 256 / BINS_PER_CHANNEL;
  for (let p = 0; p < pixelCount; p++) {
    for (let c = 0; c < COLOR_CHANNELS; c++) {
      const bin = Math.floor(data[p * RGBA_STRIDE + c] / binWidth);
      histogram[c * BINS_PER_CHANNEL + bin] += 1 / pixelCount;
    }
  }
  return histogram;
}

/**
 * Différence entre deux images RGBA de même taille : distance L1 entre leurs
 * histogrammes de couleur, ramenée dans [0, 1] (0 = identiques, 1 = disjointes).
 */
export function histogramDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const ha = colorHistogram(a);
  const hb = colorHistogram(b);
  let distance = 0;
  for (let i = 0; i < ha.length; i++) {
    distance += Math.abs(ha[i] - hb[i]);
  }
  return Math.min(1, distance / (MAX_L1_PER_CHANNEL * COLOR_CHANNELS));
}

/**
 * Temps des coupes (s) à partir des différences entre images successives
 * (`diffs[i]` = différence entre l'image i et i+1). Seuil adaptatif
 * moyenne + k·écart-type, jamais sous `minDiff`.
 */
export function detectCuts(diffs: number[], fps: number, options: CutDetectionOptions = {}): number[] {
  if (diffs.length === 0 || !(fps > 0)) return [];
  const k = options.k ?? DEFAULT_K;
  const minGapSec = options.minGapSec ?? DEFAULT_MIN_GAP_SEC;
  const minDiff = options.minDiff ?? DEFAULT_MIN_DIFF;

  const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  const variance = diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / diffs.length;
  const threshold = Math.max(mean + k * Math.sqrt(variance), minDiff);

  const candidates = diffs
    .map((diff, i) => ({ diff, time: (i + 1) / fps }))
    .filter((c) => c.diff > threshold)
    .sort((x, y) => y.diff - x.diff);

  const kept: number[] = [];
  for (const candidate of candidates) {
    if (kept.every((t) => Math.abs(t - candidate.time) >= minGapSec)) {
      kept.push(candidate.time);
    }
  }
  return kept.sort((x, y) => x - y);
}
