export interface BeatDetectionOptions {
  /** Durée (s) d'une fenêtre d'énergie. */
  windowSec?: number;
  /** Écart minimal (s) entre deux beats ; le plus fort est conservé. */
  minGapSec?: number;
  /** Facteur appliqué à la moyenne locale du flux pour qu'un pic compte. */
  sensitivity?: number;
}

const DEFAULT_WINDOW_SEC = 0.02;
const DEFAULT_MIN_GAP_SEC = 0.25;
const DEFAULT_SENSITIVITY = 1.5;
/** Largeur (s) de la moyenne locale du flux, centrée sur la fenêtre. */
const LOCAL_MEAN_SEC = 1;
/** Flux minimal : en dessous, on considère qu'il s'agit de silence ou de bruit numérique. */
const MIN_FLUX = 1e-3;

/** Énergie RMS de chaque fenêtre consécutive de `size` échantillons. */
function windowedRms(samples: Float32Array, size: number): number[] {
  const rms: number[] = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    let sum = 0;
    for (let i = start; i < start + size; i++) sum += samples[i] * samples[i];
    rms.push(Math.sqrt(sum / size));
  }
  return rms;
}

/** Flux positif : hausse d'énergie d'une fenêtre à la suivante (0 si baisse). */
function positiveFlux(rms: number[]): number[] {
  return rms.map((value, i) => Math.max(0, value - (i > 0 ? rms[i - 1] : 0)));
}

/**
 * Temps des beats (s) d'un signal mono : pics du flux d'énergie qui dépassent
 * la moyenne locale × `sensitivity`, espacés d'au moins `minGapSec`.
 */
export function detectBeats(
  samples: Float32Array,
  sampleRate: number,
  options: BeatDetectionOptions = {},
): number[] {
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC;
  const minGapSec = options.minGapSec ?? DEFAULT_MIN_GAP_SEC;
  const sensitivity = options.sensitivity ?? DEFAULT_SENSITIVITY;
  const windowSize = Math.round(windowSec * sampleRate);
  if (!(sampleRate > 0) || windowSize < 1) return [];

  const flux = positiveFlux(windowedRms(samples, windowSize));
  const halfSpan = Math.max(1, Math.round(LOCAL_MEAN_SEC / windowSec / 2));
  const frameSec = windowSize / sampleRate;

  const candidates: { strength: number; time: number }[] = [];
  for (let i = 0; i < flux.length; i++) {
    if (flux[i] < MIN_FLUX) continue;
    const isLocalMax = (i === 0 || flux[i] >= flux[i - 1]) && (i === flux.length - 1 || flux[i] > flux[i + 1]);
    if (!isLocalMax) continue;
    const from = Math.max(0, i - halfSpan);
    const to = Math.min(flux.length, i + halfSpan + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += flux[j];
    if (flux[i] > (sum / (to - from)) * sensitivity) {
      candidates.push({ strength: flux[i], time: i * frameSec });
    }
  }

  const kept: number[] = [];
  for (const candidate of candidates.sort((a, b) => b.strength - a.strength)) {
    if (kept.every((t) => Math.abs(t - candidate.time) >= minGapSec)) kept.push(candidate.time);
  }
  return kept.sort((a, b) => a - b);
}
