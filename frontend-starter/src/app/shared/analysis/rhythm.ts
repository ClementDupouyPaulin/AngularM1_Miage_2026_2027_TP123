import { averageShotLength } from './shot-length';

export type RhythmLabel = 'Contemplatif' | 'Posé' | 'Soutenu' | 'Nerveux' | 'Frénétique';
export type RhythmTone = 'calm' | 'steady' | 'brisk' | 'intense';

export interface RhythmProfile {
  cutsPerMinute: number;
  /** Durée moyenne d'un plan (s). */
  averageShotLength: number;
  /** Durée médiane d'un plan (s). */
  medianShotLength: number;
  label: RhythmLabel;
  tone: RhythmTone;
}

/** Paliers d'ASL (s), du plus lent au plus rapide : un plan au moins aussi long que `minAsl` reçoit l'étiquette. */
const RHYTHM_LEVELS: { minAsl: number; label: RhythmLabel; tone: RhythmTone }[] = [
  { minAsl: 8, label: 'Contemplatif', tone: 'calm' },
  { minAsl: 4, label: 'Posé', tone: 'steady' },
  { minAsl: 2.5, label: 'Soutenu', tone: 'brisk' },
  { minAsl: 1.2, label: 'Nerveux', tone: 'intense' },
  { minAsl: 0, label: 'Frénétique', tone: 'intense' },
];
const SECONDS_PER_MINUTE = 60;

/** Durées des plans délimités par les coupes situées dans ]0, durée[. */
export function shotLengths(cuts: number[], durationSec: number): number[] {
  if (!(durationSec > 0)) return [];
  const bounds = [0, ...cuts.filter((t) => t > 0 && t < durationSec).sort((a, b) => a - b), durationSec];
  return bounds.slice(1).map((end, i) => end - bounds[i]);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Étiquette et ton du palier d'une durée moyenne de plan (s) ; sans valeur mesurable, le palier le plus calme. */
export function rhythmFromAverageShotLength(asl: number): { label: RhythmLabel; tone: RhythmTone } {
  const level =
    Number.isFinite(asl) && asl > 0
      ? (RHYTHM_LEVELS.find((candidate) => asl >= candidate.minAsl) ?? RHYTHM_LEVELS[RHYTHM_LEVELS.length - 1])
      : RHYTHM_LEVELS[0];
  return { label: level.label, tone: level.tone };
}

/** Profil de rythme du montage : cadence, durées de plan et étiquette lisible. */
export function rhythmProfile(cuts: number[], durationSec: number): RhythmProfile {
  const asl = averageShotLength(cuts, durationSec);
  // Sans coupe ou sans durée, aucun rythme mesurable : le palier le plus calme.
  const level = cuts.length === 0 || !(durationSec > 0) ? RHYTHM_LEVELS[0] : rhythmFromAverageShotLength(asl);
  return {
    cutsPerMinute: durationSec > 0 ? (cuts.length * SECONDS_PER_MINUTE) / durationSec : 0,
    averageShotLength: asl,
    medianShotLength: median(shotLengths(cuts, durationSec)),
    label: level.label,
    tone: level.tone,
  };
}
