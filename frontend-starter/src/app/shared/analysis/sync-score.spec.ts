import { MAX_SYNC_SCORE, syncScore } from './sync-score';

const DURATION = 60;
/** Un beat toutes les 0,5 s : les fenêtres de ±80 ms couvrent 32 % du temps. */
const BEATS = Array.from({ length: 120 }, (_, i) => i * 0.5);

describe('syncScore', () => {
  it('vaut environ 1 pour des coupes sans lien avec les beats', () => {
    // Pas irrationnel par rapport à la période des beats : phases uniformément réparties.
    const step = 0.5 * ((1 + Math.sqrt(5)) / 2);
    const cuts = Array.from({ length: 70 }, (_, i) => 0.1 + i * step).filter((t) => t < DURATION);
    expect(syncScore(cuts, BEATS, DURATION)).toBeCloseTo(1, 0);
  });

  it('dépasse 1 pour des coupes alignées sur les beats', () => {
    const cuts = BEATS.filter((_, i) => i % 4 === 1).map((b) => b + 0.03);
    const score = syncScore(cuts, BEATS, DURATION)!;
    expect(score).toBeGreaterThan(2);
    expect(score).toBeLessThanOrEqual(MAX_SYNC_SCORE);
  });

  it('reste borné quand la part attendue au hasard est minuscule', () => {
    expect(syncScore([30], [30], 1000, 0.001)).toBe(MAX_SYNC_SCORE);
  });

  it('vaut null sans coupe, sans beat ou avec une durée nulle', () => {
    expect(syncScore([], BEATS, DURATION)).toBeNull();
    expect(syncScore([1], [], DURATION)).toBeNull();
    expect(syncScore([1], BEATS, 0)).toBeNull();
    expect(syncScore([1], BEATS, -5)).toBeNull();
  });
});
