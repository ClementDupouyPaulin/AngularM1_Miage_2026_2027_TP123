import { DEFAULT_K, MAX_K, MIN_K, cutThresholds, detectCuts, frameDifference } from './cut-detector';

const WIDTH = 64;
const HEIGHT = 36;

/** Image RGBA unie de `pixels` pixels. */
function solidImage(pixels: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p++) data.set([r, g, b, 255], p * 4);
  return data;
}

/** Image 64 × 36 texturée (bruit pseudo-aléatoire déterministe), décalée horizontalement de `shift` px. */
function texturedImage(seed: number, shift = 0): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const hash = Math.sin((x + shift) * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
      const level = Math.floor((hash - Math.floor(hash)) * 256);
      data.set([level, level, level, 255], (y * WIDTH + x) * 4);
    }
  }
  return data;
}

/** Bruit faible déterministe autour de `base`. */
function lowNoise(count: number, base = 0.02): number[] {
  return Array.from({ length: count }, (_, i) => base + ((i * 7) % 5) * 0.002);
}

/** Scène animée : différences élevées et irrégulières (mouvement rapide), sans coupe. */
function animatedScene(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((0.1 + 0.03 * Math.sin(i * 1.7) + 0.015 * Math.cos(i * 0.9)) * 1000) / 1000);
}

describe('frameDifference', () => {
  it('vaut 0 pour deux images identiques', () => {
    const image = texturedImage(1);
    expect(frameDifference(image, image.slice(), WIDTH)).toBe(0);
  });

  it('vaut 1 pour deux images opposées', () => {
    const pixels = WIDTH * HEIGHT;
    expect(frameDifference(solidImage(pixels, 0, 0, 0), solidImage(pixels, 255, 255, 255), WIDTH)).toBeCloseTo(1, 6);
  });

  it('ignore le canal alpha', () => {
    const opaque = texturedImage(2);
    const transparent = opaque.slice();
    for (let p = 0; p < WIDTH * HEIGHT; p++) transparent[p * 4 + 3] = 0;
    expect(frameDifference(opaque, transparent, WIDTH)).toBe(0);
  });

  it('absorbe un léger mouvement de caméra mais pas un changement de plan', () => {
    const panned = frameDifference(texturedImage(3), texturedImage(3, 2), WIDTH);
    const cut = frameDifference(texturedImage(3), texturedImage(7), WIDTH);
    expect(panned).toBeLessThan(0.1);
    expect(cut).toBeGreaterThan(3 * panned);
  });

  it('accepte une image plus petite qu’un bloc', () => {
    expect(frameDifference(solidImage(16, 0, 0, 0), solidImage(16, 255, 255, 255), WIDTH)).toBeCloseTo(1, 6);
    expect(frameDifference(new Uint8ClampedArray(0), new Uint8ClampedArray(0), WIDTH)).toBe(0);
  });
});

describe('cutThresholds', () => {
  it('s’élève dans une scène animée et reste au plancher sur un plan calme', () => {
    const diffs = [...lowNoise(30, 0.01), ...animatedScene(30)];
    const thresholds = cutThresholds(diffs, 10);
    expect(thresholds[5]).toBeLessThan(0.1);
    expect(thresholds[50]).toBeGreaterThan(0.15);
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

  it('ne trouve aucune coupe sur un mouvement de caméra lent', () => {
    const pan = Array.from({ length: 100 }, (_, i) => Math.round((0.045 + 0.015 * Math.sin(i / 6)) * 1000) / 1000);
    expect(detectCuts(pan, fps)).toEqual([]);
  });

  it('trouve une coupe sur un pic net, au temps de l’image suivante', () => {
    const diffs = lowNoise(100);
    diffs[41] = 0.9;
    expect(detectCuts(diffs, fps)).toEqual([4.2]);
  });

  it('ne garde que le plus fort de deux pics trop proches', () => {
    const diffs = lowNoise(100);
    diffs[39] = 0.7;
    diffs[41] = 0.9;
    expect(detectCuts(diffs, fps)).toEqual([4.2]);
  });

  it('garde deux pics suffisamment espacés', () => {
    const diffs = lowNoise(100);
    diffs[20] = 0.8;
    diffs[60] = 0.9;
    expect(detectCuts(diffs, fps)).toEqual([2.1, 6.1]);
  });

  it('trouve les coupes au milieu de scènes animées sans compter les pics de mouvement', () => {
    const diffs = animatedScene(120);
    diffs[30] = 0.16;
    diffs[50] = 0.35;
    diffs[90] = 0.3;
    expect(detectCuts(diffs, fps)).toEqual([5.1, 9.1]);
  });

  it('ignore une image isolée sur plan fixe (artefact d’encodage) mais garde une vraie coupe', () => {
    const diffs = lowNoise(100, 0.012);
    diffs[30] = 0.12;
    diffs[31] = 0.11;
    diffs[70] = 0.12;
    expect(detectCuts(diffs, fps)).toEqual([7.1]);
  });

  it('respecte le plancher absolu minDiff', () => {
    const diffs = lowNoise(100, 0.001);
    diffs[50] = 0.035;
    expect(detectCuts(diffs, fps, { k: MIN_K })).toEqual([]);
    expect(detectCuts(diffs, fps, { k: MIN_K, minDiff: 0.02 })).toEqual([5.1]);
  });

  it('trouve d’autant plus de coupes que k est petit', () => {
    const diffs = animatedScene(200);
    [20, 60, 100, 140, 180].forEach((i, n) => (diffs[i] = 0.14 + n * 0.04));
    let previous = -1;
    for (let k = MAX_K; k >= MIN_K; k -= 0.5) {
      const count = detectCuts(diffs, fps, { k }).length;
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    expect(detectCuts(diffs, fps, { k: MIN_K }).length).toBeGreaterThan(detectCuts(diffs, fps, { k: MAX_K }).length);
    expect(DEFAULT_K).toBeGreaterThanOrEqual(MIN_K);
    expect(DEFAULT_K).toBeLessThanOrEqual(MAX_K);
  });

  it('renvoie un tableau vide sans données ou avec un fps invalide', () => {
    expect(detectCuts([], fps)).toEqual([]);
    expect(detectCuts([0.9, 0.1], 0)).toEqual([]);
  });
});
