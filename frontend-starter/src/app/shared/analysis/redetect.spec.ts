import { ClipAnalysis } from '../models/clip.model';
import { DEFAULT_K } from './cut-detector';
import { clampSensitivity, rebuildAnalysis, redetect } from './redetect';

const FPS = 10;

/** Bruit faible avec trois pics de forces différentes et un fondu. */
function sampleDiffs(): number[] {
  const diffs = Array.from({ length: 200 }, (_, i) => 0.02 + ((i * 7) % 5) * 0.002);
  diffs[39] = 0.9;
  diffs[99] = 0.12;
  diffs[149] = 0.07;
  for (let i = 60; i < 66; i++) diffs[i] = 0.1;
  return diffs;
}

describe('clampSensitivity', () => {
  it('borne k dans [1, 6] et remplace une valeur invalide par DEFAULT_K', () => {
    expect(clampSensitivity(0)).toBe(1);
    expect(clampSensitivity(9)).toBe(6);
    expect(clampSensitivity(2.5)).toBe(2.5);
    expect(clampSensitivity(Number.NaN)).toBe(DEFAULT_K);
  });
});

describe('redetect', () => {
  it('trouve plus de coupes quand k diminue', () => {
    const diffs = sampleDiffs();
    const strict = redetect(diffs, FPS, 6).cuts;
    const loose = redetect(diffs, FPS, 1).cuts;
    expect(strict).toEqual([4]);
    expect(loose.length).toBeGreaterThan(strict.length);
    expect(loose).toEqual(expect.arrayContaining([4, 10, 15]));
  });

  it('renvoie des transitions triées contenant chaque coupe', () => {
    const { cuts, transitions } = redetect(sampleDiffs(), FPS, 3);
    expect(transitions.filter((t) => t.kind === 'cut').map((t) => t.time)).toEqual(cuts);
    transitions.slice(1).forEach((t, i) => expect(t.time).toBeGreaterThanOrEqual(transitions[i].time));
  });
});

describe('rebuildAnalysis', () => {
  const base: ClipAnalysis = {
    version: 2,
    durationSec: 20,
    fps: FPS,
    cuts: [4],
    beats: [4, 10, 15],
    syncScore: null,
    diffs: sampleDiffs(),
    palette: ['#ffffff'],
    transitions: [{ time: 4, kind: 'cut' }],
    thumbnailTimes: [0, 4.1],
    sensitivity: 6,
  };

  it('recalcule coupes, transitions, sensibilité et score de synchro', () => {
    const rebuilt = rebuildAnalysis(base, 1);
    expect(rebuilt.sensitivity).toBe(1);
    expect(rebuilt.cuts.length).toBeGreaterThan(1);
    expect(rebuilt.transitions.filter((t) => t.kind === 'cut').length).toBe(rebuilt.cuts.length);
    expect(rebuilt.syncScore).toBeGreaterThan(1);
    expect(rebuilt.thumbnailTimes).toEqual(base.thumbnailTimes);
    expect(base.cuts).toEqual([4]);
  });

  it('filtre les coupes hors de la durée', () => {
    const rebuilt = rebuildAnalysis({ ...base, durationSec: 12 }, 1);
    expect(rebuilt.cuts.every((t) => t <= 12)).toBe(true);
    expect(rebuilt.transitions.every((t) => t.time <= 12)).toBe(true);
  });
});
