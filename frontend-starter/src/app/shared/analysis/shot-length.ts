/** Durée moyenne d'un plan (ASL, s) : n coupes découpent l'extrait en n + 1 plans. */
export function averageShotLength(cuts: number[], durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return durationSec / (cuts.length + 1);
}
