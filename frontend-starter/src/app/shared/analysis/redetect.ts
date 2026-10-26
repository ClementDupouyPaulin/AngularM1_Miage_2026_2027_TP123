import { ClipAnalysis, ClipTransition } from '../models/clip.model';
import { DEFAULT_K, MAX_K, MIN_K, detectCuts } from './cut-detector';
import { syncScore } from './sync-score';
import { detectTransitions } from './transitions';

const TIME_DECIMALS = 1000;

function roundTime(value: number): number {
  return Math.round(value * TIME_DECIMALS) / TIME_DECIMALS;
}

/** Coefficient k borné à [MIN_K, MAX_K] ; DEFAULT_K s'il n'est pas un nombre. */
export function clampSensitivity(k: number): number {
  if (!Number.isFinite(k)) return DEFAULT_K;
  return Math.min(MAX_K, Math.max(MIN_K, k));
}

/** Re-détection locale des coupes et transitions depuis `diffs`, sans relire la vidéo (k plus petit = plus de coupes). */
export function redetect(diffs: number[], fps: number, k: number): { cuts: number[]; transitions: ClipTransition[] } {
  const sensitivity = clampSensitivity(k);
  const cuts = detectCuts(diffs, fps, { k: sensitivity }).map(roundTime);
  return { cuts, transitions: detectTransitions(diffs, fps, cuts, { k: sensitivity }) };
}

/** Analyse recalculée avec le coefficient `k` : coupes, transitions, sensibilité et score de synchro. */
export function rebuildAnalysis(analysis: ClipAnalysis, k: number): ClipAnalysis {
  const sensitivity = clampSensitivity(k);
  const { durationSec } = analysis;
  const withinClip = (time: number) => time >= 0 && time <= durationSec;
  const detected = redetect(analysis.diffs, analysis.fps, sensitivity);
  const cuts = detected.cuts.filter(withinClip);
  return {
    ...analysis,
    cuts,
    transitions: detected.transitions.filter((transition) => withinClip(transition.time)),
    sensitivity,
    syncScore: syncScore(cuts, analysis.beats, durationSec),
  };
}
