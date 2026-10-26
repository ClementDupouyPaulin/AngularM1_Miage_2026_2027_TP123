import { appendFileSync, mkdirSync } from 'node:fs';
import { expect, expectValidAnalysis, test } from './support/fixtures';
import { SAMPLES_MISSING_REASON, sampleExists, samplePath } from './support/samples';

interface Expectation {
  file: string;
  /** Intervalle plausible du nombre de coupes détectées (sensibilité par défaut). */
  cuts: [number, number];
}

const OBSERVATIONS = 'test-results/observations.tsv';

// Intervalles fixés après observation des valeurs réelles (voir observations.tsv).
const SAMPLES: Expectation[] = [
  { file: 'sintel_trailer-480p.mp4', cuts: [10, 80] },
  { file: 'sintel_10s_360.mp4', cuts: [2, 5] },
  { file: 'sintel_10s_720.mp4', cuts: [2, 5] },
  { file: 'bbb_10s_360.mp4', cuts: [0, 2] },
  { file: 'bbb_10s_360.webm', cuts: [0, 2] },
  { file: 'bbb_10s_720.mp4', cuts: [0, 2] },
  { file: 'jellyfish_10s_360.mp4', cuts: [0, 2] },
  { file: 'jellyfish_10s_360.webm', cuts: [0, 2] },
];

for (const { file, cuts } of SAMPLES) {
  test(`qualité de détection : ${file}`, async ({ studio }) => {
    const path = samplePath(file);
    test.skip(!sampleExists(path), SAMPLES_MISSING_REASON);
    await studio.goto();
    const elapsed = await studio.analyze(path);
    const { analysis } = await studio.send();

    const fades = analysis.transitions.filter((transition) => transition.kind === 'fade').length;
    const row = [file, analysis.durationSec.toFixed(1), analysis.cuts.length, fades, analysis.beats.length, analysis.syncScore ?? 'null', elapsed].join('\t');
    console.log(`[observé] fichier=${file} durée=${analysis.durationSec.toFixed(1)}s coupes=${analysis.cuts.length} fondus=${fades} beats=${analysis.beats.length} sync=${analysis.syncScore} analyse=${elapsed}ms`);
    mkdirSync('test-results', { recursive: true });
    appendFileSync(OBSERVATIONS, `${row}\n`);

    expectValidAnalysis(analysis);
    expect(analysis.cuts.length).toBeGreaterThanOrEqual(cuts[0]);
    expect(analysis.cuts.length).toBeLessThanOrEqual(cuts[1]);
    expect(studio.consoleErrors).toEqual([]);
  });
}
