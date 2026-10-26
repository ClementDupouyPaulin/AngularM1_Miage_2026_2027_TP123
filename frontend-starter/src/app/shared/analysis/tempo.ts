const MIN_BPM = 70;
const MAX_BPM = 180;
const MIN_BEATS = 4;
/** Demi-largeur (BPM) de la fenêtre qui regroupe les intervalles autour du pic de l'histogramme. */
const PEAK_HALF_WIDTH = 2;
const SECONDS_PER_MINUTE = 60;

/** Ramène un tempo dans [MIN_BPM, MAX_BPM] par doublements ou divisions par deux. */
function foldBpm(bpm: number): number {
  let folded = bpm;
  while (folded < MIN_BPM) folded *= 2;
  while (folded > MAX_BPM) folded /= 2;
  return folded;
}

/**
 * Tempo (BPM entier) des beats : histogramme des intervalles inter-beats
 * convertis en BPM et repliés dans 70–180 ; on retient le pic (fenêtre de
 * ±2 BPM) et la moyenne des tempos qui y tombent. `null` sous 4 beats.
 */
export function estimateTempo(beats: number[]): number | null {
  if (beats.length < MIN_BEATS) return null;
  const sorted = [...beats].sort((a, b) => a - b);
  const tempos = sorted
    .slice(1)
    .map((beat, i) => beat - sorted[i])
    .filter((interval) => interval > 0)
    .map((interval) => foldBpm(SECONDS_PER_MINUTE / interval));
  if (tempos.length === 0) return null;

  const histogram = new Map<number, number>();
  for (const tempo of tempos) {
    const bin = Math.round(tempo);
    histogram.set(bin, (histogram.get(bin) ?? 0) + 1);
  }
  const windowCount = (center: number) => {
    let count = 0;
    for (let bin = center - PEAK_HALF_WIDTH; bin <= center + PEAK_HALF_WIDTH; bin++) count += histogram.get(bin) ?? 0;
    return count;
  };
  let peak = MIN_BPM;
  for (let bin = MIN_BPM; bin <= MAX_BPM; bin++) {
    if (windowCount(bin) > windowCount(peak)) peak = bin;
  }
  const inPeak = tempos.filter((tempo) => Math.abs(tempo - peak) <= PEAK_HALF_WIDTH + 0.5);
  return Math.round(inPeak.reduce((sum, tempo) => sum + tempo, 0) / inPeak.length);
}
