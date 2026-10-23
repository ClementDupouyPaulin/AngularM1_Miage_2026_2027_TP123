import { averageShotLength } from './shot-length';

describe('averageShotLength', () => {
  it('divise la durée par le nombre de plans', () => {
    expect(averageShotLength([2, 5, 7], 12)).toBe(3);
  });

  it('vaut la durée entière sans coupe', () => {
    expect(averageShotLength([], 8)).toBe(8);
  });

  it('vaut 0 pour une durée nulle ou négative', () => {
    expect(averageShotLength([1], 0)).toBe(0);
    expect(averageShotLength([1], -3)).toBe(0);
  });
});
