import { estimateTempo } from './tempo';

function periodic(period: number, count: number, offset = 0.2): number[] {
  return Array.from({ length: count }, (_, i) => offset + i * period);
}

describe('estimateTempo', () => {
  it('trouve le tempo de beats réguliers', () => {
    expect(estimateTempo(periodic(0.5, 16))).toBe(120);
    expect(estimateTempo(periodic(0.4, 16))).toBe(150);
  });

  it('replie le tempo dans 70–180', () => {
    expect(estimateTempo(periodic(1, 10))).toBe(120);
    expect(estimateTempo(periodic(0.25, 20))).toBe(120);
  });

  it('résiste à quelques beats parasites et à l’ordre', () => {
    const beats = [...periodic(0.5, 20), 3.45, 7.1].sort(() => 0).reverse();
    expect(estimateTempo(beats)).toBe(120);
  });

  it('vaut null sous 4 beats ou sans intervalle utile', () => {
    expect(estimateTempo([0.5, 1, 1.5])).toBeNull();
    expect(estimateTempo([1, 1, 1, 1])).toBeNull();
  });
});
