import { Page, expect, test as base } from '@playwright/test';
import { ApiMock, MockAnalysis, UploadedForm, installApiMock } from './api-mock';

export interface Studio {
  page: Page;
  api: ApiMock;
  consoleErrors: string[];
  goto(): Promise<void>;
  /** Dépose le fichier et attend la fin de l'analyse ; renvoie la durée d'analyse en ms. */
  analyze(path: string): Promise<number>;
  /** Clique sur « Enregistrer » et renvoie le corps multipart reçu par l'API simulée. */
  send(): Promise<UploadedForm & { video: { name: string; size: number; type: string; transport: string } }>;
  cutCount(): Promise<number>;
}

export const test = base.extend<{ studio: Studio }>({
  studio: async ({ page }, use) => {
    const api = await installApiMock(page);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${message.text()} ${message.location().url}`);
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const cutCount = async () => Number(await page.locator('.stat-cuts').innerText());
    await use({
      page,
      api,
      consoleErrors,
      cutCount,
      goto: async () => {
        await page.goto('/clips');
        await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
      },
      analyze: async (path) => {
        const started = Date.now();
        await page.locator('#clip-file').setInputFiles(path);
        await expect(page.getByRole('heading', { name: 'Résultat de l’analyse' })).toBeVisible();
        return Date.now() - started;
      },
      send: async () => {
        const before = api.uploads.length;
        await page.getByRole('button', { name: 'Enregistrer dans le Studio' }).click();
        await expect.poll(() => api.uploads.length).toBe(before + 1);
        await expect(page.locator('.created')).toBeVisible();
        const sent = await page.evaluate(() => (window as unknown as { __sentVideos: { name: string; size: number; type: string; transport: string }[] }).__sentVideos);
        return { ...api.uploads[before], video: sent[sent.length - 1] };
      },
    });
  },
});

export { expect };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Vérifie la forme de l'analyse v2 telle que l'API l'attend. */
export function expectValidAnalysis(analysis: MockAnalysis): void {
  expect(analysis.version).toBe(2);
  expect(analysis.fps).toBe(10);
  expect(analysis.durationSec).toBeGreaterThan(0);
  const { cuts, diffs, palette, transitions, thumbnailTimes } = analysis;

  expect(cuts).toEqual([...cuts].sort((a, b) => a - b));
  for (const cut of cuts) {
    expect(cut).toBeGreaterThanOrEqual(0);
    expect(cut).toBeLessThanOrEqual(analysis.durationSec);
  }
  expect(Math.abs(diffs.length - analysis.durationSec * analysis.fps)).toBeLessThanOrEqual(analysis.fps);
  for (const diff of diffs) {
    expect(diff).toBeGreaterThanOrEqual(0);
    expect(diff).toBeLessThanOrEqual(1);
  }
  expect(palette.length).toBe(Math.ceil(analysis.durationSec));
  for (const color of palette) expect(color).toMatch(HEX_COLOR);

  const times = transitions.map((transition) => transition.time);
  expect(times).toEqual([...times].sort((a, b) => a - b));
  expect(transitions.filter((transition) => transition.kind === 'cut').length).toBe(cuts.length);

  expect(thumbnailTimes.length).toBeGreaterThanOrEqual(1);
  expect(thumbnailTimes.length).toBeLessThanOrEqual(41);
  for (const time of thumbnailTimes) {
    expect(time).toBeGreaterThanOrEqual(0);
    expect(time).toBeLessThanOrEqual(analysis.durationSec);
  }
  expect(analysis.beats).toEqual([...analysis.beats].sort((a, b) => a - b));
}
