import { ClipTransition } from '../models/clip.model';
import { cutThresholds, diffStatistics } from './cut-detector';

export interface TransitionDetectionOptions {
  /** Coefficient k du seuil de coupe (voir `detectCuts`). */
  k?: number;
  /** Plancher absolu du seuil de coupe. */
  minDiff?: number;
  /** Nombre minimal d'images consécutives d'un fondu. */
  minFrames?: number;
  /** Somme minimale des différences d'un fondu. */
  minSum?: number;
}

const DEFAULT_MIN_FRAMES = 3;
const DEFAULT_MIN_SUM = 0.35;
const TIME_DECIMALS = 1000;

function roundTime(value: number): number {
  return Math.round(value * TIME_DECIMALS) / TIME_DECIMALS;
}

/** Fenêtres [début, fin] (indices de `diffs`) de différences modérées consécutives. */
function moderateRuns(diffs: number[], low: number, high: number[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  diffs.forEach((diff, i) => {
    const moderate = diff > low && diff < high[i];
    if (moderate && start < 0) start = i;
    if (!moderate && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, diffs.length - 1]);
  return runs;
}

/**
 * Transitions triées par temps : chaque coupe (`cut`), plus les fondus (`fade`),
 * fenêtres d'au moins `minFrames` différences consécutives au-dessus de
 * moyenne + 1σ (calculées hors coupes) mais sous le seuil local de coupe, de somme ≥ `minSum`, sans coupe
 * à l'intérieur. Un fondu est daté au centre de sa fenêtre.
 */
export function detectTransitions(
  diffs: number[],
  fps: number,
  cuts: number[],
  options: TransitionDetectionOptions = {},
): ClipTransition[] {
  const transitions: ClipTransition[] = cuts.map((time) => ({ time, kind: 'cut' }));
  if (diffs.length > 0 && fps > 0) {
    const minFrames = options.minFrames ?? DEFAULT_MIN_FRAMES;
    const minSum = options.minSum ?? DEFAULT_MIN_SUM;
    const high = cutThresholds(diffs, fps, options.k, options.minDiff);
    // Les coupes fortes gonfleraient σ et masqueraient tout fondu : stats calculées sans elles.
    const { mean, deviation } = diffStatistics(diffs.filter((diff, i) => diff < high[i]));
    const cutFrames = cuts.map((time) => Math.round(time * fps) - 1);

    for (const [start, end] of moderateRuns(diffs, mean + deviation, high)) {
      if (end - start + 1 < minFrames) continue;
      if (cutFrames.some((frame) => frame >= start && frame <= end)) continue;
      const sum = diffs.slice(start, end + 1).reduce((total, d) => total + d, 0);
      if (sum < minSum) continue;
      transitions.push({ time: roundTime((start + end + 1) / 2 / fps), kind: 'fade' });
    }
  }
  return transitions.sort((a, b) => a.time - b.time);
}
