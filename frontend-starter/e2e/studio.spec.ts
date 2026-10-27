import { statSync } from 'node:fs';
import { DEFAULT_K } from '../src/app/shared/analysis/cut-detector';
import { expect, expectValidAnalysis, test } from './support/fixtures';
import { SAMPLES_MISSING_REASON, rejectedPath, sampleExists, samplePath } from './support/samples';

const MP4 = samplePath('sintel_10s_360.mp4');
const WEBM = samplePath('bbb_10s_360.webm');
const TRAILER = samplePath('sintel_trailer-480p.mp4');
const JELLYFISH = samplePath('jellyfish_10s_360.mp4');

const REFUSED = [
  { file: 'sintel_trailer_format_ogv.ogv', message: /Format non accepté/ },
  { file: 'bbb_trailer_format_mov.mov', message: /Format non accepté/ },
  { file: 'faux_fichier_texte.mp4', message: /Impossible de lire cette vidéo/ },
  { file: 'fichier_vide.mp4', message: /vide/ },
  { file: 'big_buck_bunny_complet_57Mo_10min.webm', message: /trop volumineux/ },
];

function needSamples(...paths: string[]): void {
  test.skip(paths.some((path) => !sampleExists(path)), SAMPLES_MISSING_REASON);
}

test.describe('Import et analyse de vraies vidéos', () => {
  test('(a) MP4 valide : analyse, résultats, envoi multipart conforme', async ({ studio }) => {
    needSamples(MP4);
    await studio.goto();
    const elapsed = await studio.analyze(MP4);
    console.log(`[observé] ${MP4} : ${await studio.cutCount()} coupes en ${elapsed} ms`);

    await expect(studio.page.locator('.stat-beats')).toBeVisible();
    await expect(studio.page.locator('.stat-rhythm')).not.toBeEmpty();
    await studio.page.getByLabel('Titre', { exact: true }).fill('Sintel 10 s');
    await studio.page.locator('#clip-tag').fill('animation,test');
    await studio.page.locator('#clip-tag').press('Enter');

    const upload = await studio.send();
    expect(upload.fields['title']).toBe('Sintel 10 s');
    expect(JSON.parse(upload.fields['tags'])).toEqual(['animation', 'test']);
    expect(upload.fields['visibility']).toBe('private');
    expect(upload.files['video'].filename).toBe('sintel_10s_360.mp4');
    console.log(`[observé] transport d'envoi : ${upload.video.transport}`);
    expect(upload.video).toMatchObject({ name: 'sintel_10s_360.mp4', size: statSync(MP4).size, type: 'video/mp4' });
    expect(upload.files['filmstrip'].size).toBeGreaterThan(1_000);
    expectValidAnalysis(upload.analysis);
    expect(Math.round(upload.analysis.durationSec)).toBeGreaterThanOrEqual(9);
    expect(Math.round(upload.analysis.durationSec)).toBeLessThanOrEqual(11);
    expect(upload.analysis.sensitivity).toBe(DEFAULT_K);
    expect(upload.analysis.thumbnailTimes[0]).toBe(0);
    expect(studio.api.unhandled).toEqual([]);
    expect(studio.consoleErrors).toEqual([]);
    await expect(studio.page.getByText('Votre bibliothèque est vide.')).toBeHidden();
  });

  test('(b) WebM valide : analyse et envoi', async ({ studio }) => {
    needSamples(WEBM);
    await studio.goto();
    await studio.analyze(WEBM);
    const upload = await studio.send();
    expectValidAnalysis(upload.analysis);
    expect(upload.files['video'].filename).toBe('bbb_10s_360.webm');
    expect(studio.consoleErrors).toEqual([]);
  });

  for (const { file, message } of REFUSED) {
    test(`(c) refus de ${file}`, async ({ studio }) => {
      needSamples(rejectedPath(file));
      await studio.goto();
      await studio.page.locator('#clip-file').setInputFiles(rejectedPath(file));
      await expect(studio.page.getByRole('alert').filter({ hasText: message })).toBeVisible();
      await expect(studio.page.getByRole('heading', { name: 'Résultat de l’analyse' })).toBeHidden();
      await expect(studio.page.getByRole('button', { name: 'Enregistrer dans le Studio' })).toBeHidden();
      expect(studio.api.uploads).toEqual([]);
    });
  }

  test('(d) annulation en cours d’analyse', async ({ studio }) => {
    needSamples(TRAILER);
    await studio.goto();
    await studio.page.locator('#clip-file').setInputFiles(TRAILER);
    await studio.page.getByRole('button', { name: 'Annuler l’analyse' }).click();
    await expect(studio.page.getByRole('status').filter({ hasText: 'Analyse annulée.' })).toBeAttached();
    await expect(studio.page.getByRole('button', { name: 'Annuler l’analyse' })).toBeHidden();
    await expect(studio.page.getByRole('heading', { name: 'Résultat de l’analyse' })).toBeHidden();
    expect(studio.api.uploads).toEqual([]);
    expect(studio.consoleErrors).toEqual([]);
    await expect(studio.page.getByRole('button', { name: 'Relancer l’analyse' })).toBeVisible();
  });

  test('(e) sensibilité : plus sensible, jamais moins de coupes', async ({ studio }) => {
    needSamples(TRAILER);
    await studio.goto();
    await studio.analyze(TRAILER);
    const slider = studio.page.getByRole('slider', { name: /Sensibilité de détection/ });
    const counts: number[] = [];
    for (let level = 1; level <= 6; level += 0.5) {
      await slider.fill(String(level));
      await expect(slider).toHaveAttribute('aria-valuetext', new RegExp(`k = ${(7 - level).toFixed(1).replace('.', ',')}`));
      counts.push(await studio.cutCount());
    }
    console.log(`[observé] sensibilité (niveau 1 à 6 par 0,5) sur le trailer : ${counts.join(', ')} coupes`);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts.at(-1)).toBeGreaterThan(counts[0]);
  });

  test('(f) méduse, plan unique : au plus 2 coupes', async ({ studio }) => {
    needSamples(JELLYFISH);
    await studio.goto();
    await studio.analyze(JELLYFISH);
    const cuts = await studio.cutCount();
    console.log(`[observé] ${JELLYFISH} : ${cuts} coupes`);
    expect(cuts).toBeLessThanOrEqual(2);
  });
});
