import { rhythmFromAverageShotLength, rhythmProfile, shotLengths } from './rhythm';

/** Coupes régulières tous les `step` secondes sur `duration`. */
function evenCuts(step: number, duration: number): number[] {
  const count = Math.round(duration / step) - 1;
  return Array.from({ length: count }, (_, i) => Math.round((i + 1) * step * 1000) / 1000);
}

describe('shotLengths', () => {
  it('découpe la durée aux coupes situées dans l’extrait', () => {
    expect(shotLengths([5, 2, 12, 0], 10)).toEqual([2, 3, 5]);
    expect(shotLengths([1], 0)).toEqual([]);
  });
});

describe('rhythmProfile', () => {
  it('calcule cadence, ASL et durée médiane', () => {
    const profile = rhythmProfile([1, 2, 6], 12);
    expect(profile.cutsPerMinute).toBe(15);
    expect(profile.averageShotLength).toBe(3);
    expect(profile.medianShotLength).toBe(2.5);
    expect(profile.label).toBe('Soutenu');
    expect(profile.tone).toBe('brisk');
  });

  it('attribue l’étiquette selon les paliers d’ASL', () => {
    const cases: [number, string, string][] = [
      [10, 'Contemplatif', 'calm'],
      [8, 'Contemplatif', 'calm'],
      [5, 'Posé', 'steady'],
      [4, 'Posé', 'steady'],
      [2.5, 'Soutenu', 'brisk'],
      [2, 'Nerveux', 'intense'],
      [1.2, 'Nerveux', 'intense'],
      [1, 'Frénétique', 'intense'],
    ];
    for (const [step, label, tone] of cases) {
      const profile = rhythmProfile(evenCuts(step, 120), 120);
      expect(profile.averageShotLength).toBeCloseTo(step, 6);
      expect([profile.label, profile.tone]).toEqual([label, tone]);
    }
  });

  it('reste défini sans coupe ou sans durée', () => {
    expect(rhythmProfile([], 30)).toMatchObject({ cutsPerMinute: 0, averageShotLength: 30, medianShotLength: 30, label: 'Contemplatif' });
    expect(rhythmProfile([], 0)).toMatchObject({ cutsPerMinute: 0, averageShotLength: 0, medianShotLength: 0, label: 'Contemplatif', tone: 'calm' });
    expect(rhythmProfile([1, 2], -5)).toMatchObject({ cutsPerMinute: 0, label: 'Contemplatif', tone: 'calm' });
    expect(rhythmProfile([], 3)).toMatchObject({ cutsPerMinute: 0, label: 'Contemplatif' });
  });
});

describe('rhythmFromAverageShotLength', () => {
  it('applique les mêmes paliers que rhythmProfile', () => {
    for (const step of [10, 8, 5, 4, 2.5, 2, 1.2, 1]) {
      const profile = rhythmProfile(evenCuts(step, 120), 120);
      expect(rhythmFromAverageShotLength(profile.averageShotLength)).toEqual({ label: profile.label, tone: profile.tone });
    }
  });

  it('renvoie le palier le plus calme sans valeur mesurable', () => {
    for (const asl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rhythmFromAverageShotLength(asl)).toEqual({ label: 'Contemplatif', tone: 'calm' });
    }
  });
});
