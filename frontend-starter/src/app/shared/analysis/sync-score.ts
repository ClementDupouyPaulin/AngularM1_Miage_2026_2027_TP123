/** Score maximal : évite l'infini quand la part attendue au hasard est quasi nulle. */
export const MAX_SYNC_SCORE = 10;

/** Durée totale (s) de l'union des fenêtres [b - w, b + w] bornées à [0, durée]. */
function coveredDuration(beats: number[], durationSec: number, windowSec: number): number {
  const sorted = [...beats].sort((a, b) => a - b);
  let covered = 0;
  let end = 0;
  for (const beat of sorted) {
    const start = Math.max(0, beat - windowSec, end);
    const stop = Math.min(durationSec, beat + windowSec);
    if (stop > start) {
      covered += stop - start;
      end = stop;
    }
  }
  return covered;
}

/**
 * Synchronisation du montage sur la musique : part des coupes à ±`windowSec`
 * d'un beat, rapportée à la part attendue au hasard (≈ 1 = aucun lien,
 * > 1 = coupes calées sur les beats). `null` si le calcul n'a pas de sens.
 */
export function syncScore(cuts: number[], beats: number[], durationSec: number, windowSec = 0.08): number | null {
  if (cuts.length === 0 || beats.length === 0 || !(durationSec > 0)) return null;

  const hits = cuts.filter((cut) => beats.some((beat) => Math.abs(cut - beat) <= windowSec)).length;
  const hitRate = hits / cuts.length;
  const chanceRate = Math.min(1, coveredDuration(beats, durationSec, windowSec) / durationSec);
  if (chanceRate === 0) return hitRate > 0 ? MAX_SYNC_SCORE : 0;
  return Math.min(MAX_SYNC_SCORE, hitRate / chanceRate);
}
