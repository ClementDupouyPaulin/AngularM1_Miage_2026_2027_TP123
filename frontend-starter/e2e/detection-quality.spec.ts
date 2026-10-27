import { appendFileSync, mkdirSync } from 'node:fs';
import { MAX_K, MIN_K } from '../src/app/shared/analysis/cut-detector';
import { redetect } from '../src/app/shared/analysis/redetect';
import { expect, expectValidAnalysis, test } from './support/fixtures';
import { GROUND_TRUTH, matchCuts } from './support/ground-truth';
import { SAMPLES_MISSING_REASON, sampleExists, samplePath } from './support/samples';

interface Expectation {
  file: string;
  /** Rappel et précision minimaux à la sensibilité par défaut, par rapport à la vérité terrain. */
  recall: number;
  precision: number;
}

const OBSERVATIONS = 'test-results/observations.tsv';
const SENSITIVITY_STEP = 0.5;

// Seuils fixés d'après la vérité terrain (support/ground-truth.ts) ; plans uniques : aucune fausse coupe.
const SAMPLES: Expectation[] = [
  { file: 'sintel_trailer-480p.mp4', recall: 0.85, precision: 0.9 },
  { file: 'sintel_10s_360.mp4', recall: 0.75, precision: 0.85 },
  { file: 'sintel_10s_720.mp4', recall: 0.75, precision: 0.85 },
  { file: 'bbb_10s_360.mp4', recall: 1, precision: 1 },
  { file: 'bbb_10s_360.webm', recall: 1, precision: 1 },
  { file: 'bbb_10s_720.mp4', recall: 1, precision: 1 },
  { file: 'jellyfish_10s_360.mp4', recall: 1, precision: 1 },
  { file: 'jellyfish_10s_360.webm', recall: 1, precision: 1 },
];

/** Nombre de coupes pour k décroissant de MAX_K à MIN_K. */
function sensitivitySweep(diffs: number[], fps: number): number[] {
  const counts: number[] = [];
  for (let k = MAX_K; k >= MIN_K; k -= SENSITIVITY_STEP) counts.push(redetect(diffs, fps, k).cuts.length);
  return counts;
}

for (const { file, recall, precision } of SAMPLES) {
  test(`qualité de détection : ${file}`, async ({ studio }) => {
    const path = samplePath(file);
    test.skip(!sampleExists(path), SAMPLES_MISSING_REASON);
    await studio.goto();
    const elapsed = await studio.analyze(path);
    const { analysis } = await studio.send();

    const fades = analysis.transitions.filter((transition) => transition.kind === 'fade').length;
    const score = matchCuts(analysis.cuts, GROUND_TRUTH[file]);
    const sweep = sensitivitySweep(analysis.diffs, analysis.fps);
    const row = [file, analysis.durationSec.toFixed(1), analysis.cuts.length, fades, score.recall.toFixed(2), score.precision.toFixed(2), sweep.join(','), elapsed].join('\t');
    console.log(
      `[observé] fichier=${file} coupes=${analysis.cuts.length} fondus=${fades} rappel=${score.recall.toFixed(2)} précision=${score.precision.toFixed(2)} ` +
        `manquées=[${score.missed}] fausses=[${score.falseCuts}] k6→1=[${sweep}] analyse=${elapsed}ms`,
    );
    mkdirSync('test-results', { recursive: true });
    appendFileSync(OBSERVATIONS, `${row}\n`);

    expectValidAnalysis(analysis);
    expect(score.recall).toBeGreaterThanOrEqual(recall);
    expect(score.precision).toBeGreaterThanOrEqual(precision);
    sweep.slice(1).forEach((count, i) => expect(count).toBeGreaterThanOrEqual(sweep[i]));
    expect(studio.consoleErrors).toEqual([]);
  });
}
