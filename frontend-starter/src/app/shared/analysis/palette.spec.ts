import { dominantColor, paletteFromColors } from './palette';

function image(pixels: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], p) => data.set([r, g, b, 255], p * 4));
  return data;
}

describe('dominantColor', () => {
  it('renvoie la couleur moyenne de la case la plus peuplée', () => {
    const pixels: [number, number, number][] = [
      [200, 10, 10],
      [210, 20, 12],
      [205, 15, 14],
      [10, 10, 200],
    ];
    expect(dominantColor(image(pixels))).toBe('#cd0f0c');
  });

  it('ignore le quasi-noir pur', () => {
    const pixels: [number, number, number][] = [
      [0, 0, 0],
      [2, 3, 1],
      [0, 0, 0],
      [40, 120, 60],
    ];
    expect(dominantColor(image(pixels))).toBe('#28783c');
  });

  it('vaut #000000 pour une image entièrement noire ou vide', () => {
    expect(dominantColor(image([[0, 0, 0]]))).toBe('#000000');
    expect(dominantColor(new Uint8ClampedArray(0))).toBe('#000000');
  });
});

describe('paletteFromColors', () => {
  it('garde la couleur la plus fréquente de chaque seconde', () => {
    const colors = [
      ...Array(6).fill('#ff0000'),
      ...Array(4).fill('#00ff00'),
      ...Array(3).fill('#0000ff'),
      ...Array(7).fill('#00ff00'),
      '#ffffff',
    ];
    expect(paletteFromColors(colors, 10)).toEqual(['#ff0000', '#00ff00', '#ffffff']);
  });

  it('départage les égalités par la première couleur rencontrée', () => {
    expect(paletteFromColors(['#111111', '#222222', '#222222', '#111111'], 4)).toEqual(['#111111']);
  });

  it('renvoie une palette vide sans image ou avec un fps invalide', () => {
    expect(paletteFromColors([], 10)).toEqual([]);
    expect(paletteFromColors(['#ffffff'], 0)).toEqual([]);
  });
});
