import { detectCuts } from './cut-detector';
import { detectTransitions } from './transitions';

const FPS = 10;

/** Bruit faible déterministe. */
function lowNoise(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 0.02 + ((i * 7) % 5) * 0.002);
}

describe('detectTransitions', () => {
  it('reprend chaque coupe comme transition « cut »', () => {
    expect(detectTransitions(lowNoise(50), FPS, [1.2, 3])).toEqual([
      { time: 1.2, kind: 'cut' },
      { time: 3, kind: 'cut' },
    ]);
  });

  it('détecte un fondu au centre d’une fenêtre de différences modérées', () => {
    const diffs = lowNoise(100);
    diffs[70] = 0.9;
    for (let i = 30; i < 36; i++) diffs[i] = 0.07;
    const cuts = detectCuts(diffs, FPS);

    expect(cuts).toEqual([7.1]);
    expect(detectTransitions(diffs, FPS, cuts)).toEqual([
      { time: 3.3, kind: 'fade' },
      { time: 7.1, kind: 'cut' },
    ]);
  });

  it('détecte un fondu progressif malgré deux coupes fortes', () => {
    const diffs = lowNoise(120);
    diffs[20] = 0.95;
    diffs[90] = 0.9;
    [0.05, 0.07, 0.085, 0.085, 0.07, 0.05].forEach((d, i) => (diffs[50 + i] = d));
    const cuts = detectCuts(diffs, FPS);

    expect(cuts).toEqual([2.1, 9.1]);
    expect(detectTransitions(diffs, FPS, cuts)).toEqual([
      { time: 2.1, kind: 'cut' },
      { time: 5.3, kind: 'fade' },
      { time: 9.1, kind: 'cut' },
    ]);
  });

  it('ignore les fenêtres trop courtes ou de somme trop faible', () => {
    const short = lowNoise(100);
    short[30] = 0.2;
    short[31] = 0.2;
    expect(detectTransitions(short, FPS, [])).toEqual([]);

    const faint = lowNoise(100);
    for (let i = 30; i < 34; i++) faint[i] = 0.06;
    expect(detectTransitions(faint, FPS, [])).toEqual([]);
  });

  it('ne compte pas de fondu contenant une coupe', () => {
    const diffs = lowNoise(100);
    for (let i = 30; i < 36; i++) diffs[i] = 0.12;
    expect(detectTransitions(diffs, FPS, [3.3], { k: 6 })).toEqual([{ time: 3.3, kind: 'cut' }]);
  });

  it('gère l’absence de données', () => {
    expect(detectTransitions([], FPS, [])).toEqual([]);
    expect(detectTransitions([0.5, 0.5, 0.5], 0, [1])).toEqual([{ time: 1, kind: 'cut' }]);
  });
});
