import { detectCuts, histogramDifference } from './cut-detector';

/** Image RGBA unie de `pixels` pixels. */
function solidImage(pixels: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p++) data.set([r, g, b, 255], p * 4);
  return data;
}

/** Bruit faible déterministe autour de `base`. */
function lowNoise(count: number, base = 0.02): number[] {
  return Array.from({ length: count }, (_, i) => base + ((i * 7) % 5) * 0.002);
}

describe('histogramDifference', () => {
  it('vaut 0 pour deux images identiques', () => {
    const image = solidImage(64, 120, 30, 200);
    expect(histogramDifference(image, image.slice())).toBe(0);
  });

  it('vaut environ 1 pour deux images opposées', () => {
    expect(histogramDifference(solidImage(64, 0, 0, 0), solidImage(64, 255, 255, 255))).toBeCloseTo(1, 6);
  });

  it('ignore le canal alpha', () => {
    const opaque = solidImage(4, 10, 20, 30);
    const transparent = opaque.slice();
    for (let p = 0; p < 4; p++) transparent[p * 4 + 3] = 0;
    expect(histogramDifference(opaque, transparent)).toBe(0);
  });
});

describe('detectCuts', () => {
  const fps = 10;

  it('ne trouve aucune coupe sur un bruit faible', () => {
    expect(detectCuts(lowNoise(100), fps)).toEqual([]);
  });

  it('ne trouve aucune coupe sur un fondu léger régulier', () => {
    expect(detectCuts(Array(60).fill(0.05), fps)).toEqual([]);
  });

  it('trouve une coupe sur un pic net, au temps de l’image suivante', () => {
    const diffs = lowNoise(100);
    diffs[41] = 0.9;
    expect(detectCuts(diffs, fps)).toEqual([4.2]);
  });

  it('ne garde que le plus fort de deux pics trop proches', () => {
    const diffs = lowNoise(100);
    diffs[40] = 0.7;
    diffs[41] = 0.9;
    expect(detectCuts(diffs, fps)).toEqual([4.2]);
  });

  it('garde deux pics suffisamment espacés', () => {
    const diffs = lowNoise(100);
    diffs[20] = 0.8;
    diffs[60] = 0.9;
    expect(detectCuts(diffs, fps)).toEqual([2.1, 6.1]);
  });

  it('respecte le plancher absolu minDiff', () => {
    const diffs = lowNoise(100, 0.001);
    diffs[50] = 0.1;
    expect(detectCuts(diffs, fps)).toEqual([]);
    expect(detectCuts(diffs, fps, { minDiff: 0.05 })).toEqual([5.1]);
  });

  it('renvoie un tableau vide sans données ou avec un fps invalide', () => {
    expect(detectCuts([], fps)).toEqual([]);
    expect(detectCuts([0.9, 0.1], 0)).toEqual([]);
  });
});
