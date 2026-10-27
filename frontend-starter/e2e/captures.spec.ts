import { Locator, Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CaptureApi, LoggedRequest } from './support/captures-api';
import { SAMPLES_MISSING_REASON, sampleExists, samplePath } from './support/samples';

const OUTPUT_DIR = resolve(process.cwd(), 'docs', 'captures', 'film-pulse');
const VIEWPORT = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

const TRAILER = 'sintel_trailer-480p.mp4';
const IMPORTS = [
  { file: TRAILER, title: 'Sintel — bande-annonce', tags: ['animation', 'trailer'], visibility: 'public' },
  { file: 'sintel_10s_360.mp4', title: 'Sintel — extrait de 10 s', tags: ['animation'], visibility: 'private' },
  { file: 'bbb_10s_360.mp4', title: 'Big Buck Bunny — forêt', tags: ['animation', 'comédie'], visibility: 'public' },
  { file: 'jellyfish_10s_360.mp4', title: 'Méduses — plan unique', tags: ['nature', 'calme'], visibility: 'private' },
  { file: 'bbb_10s_360.webm', title: 'Big Buck Bunny — WebM', tags: ['comédie'], visibility: 'private' },
];
const LIVE_PROGRESS_PERCENT = 35;

test.skip(process.env['CAPTURES'] !== '1', 'Captures du rapport : lancer avec `npm run captures` (CAPTURES=1).');
test.skip(IMPORTS.some(({ file }) => !sampleExists(samplePath(file))), SAMPLES_MISSING_REASON);

/** Réseau consigné pendant le parcours en thème sombre (le parcours clair est identique). */
let networkLog: LoggedRequest[] = [];

async function settle(page: Page): Promise<void> {
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function shoot(page: Page, theme: Theme, name: string, target?: Locator): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await settle(page);
  const path = `${OUTPUT_DIR}/${name}-${theme}.png`;
  if (target) {
    // Une capture d'élément fait défiler la page : l'en-tête collant la recouvrirait.
    await page.addStyleTag({ content: '.app-header { position: static !important; }' });
    await target.screenshot({ path });
  }
  else {
    // Défilement jusqu'en bas : les images hors écran (affiches des cartes) se chargent à la demande.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await settle(page);
    // L'en-tête collant se dessinerait au milieu de la capture si la page restait défilée.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path, fullPage: true });
  }
}

/**
 * Navigation côté client : `index.html` n'a pas de `<base href="/">`, donc un rechargement
 * direct sur une URL à deux segments (`/clips/:id`) ne retrouve ni `main.js` ni `styles.css`.
 */
async function openInApp(page: Page, url: string): Promise<void> {
  await page.evaluate((target) => {
    history.pushState({}, '', target);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

async function importClip(page: Page, entry: (typeof IMPORTS)[number], alreadySelected = false): Promise<void> {
  if (!alreadySelected) await page.locator('#clip-file').setInputFiles(samplePath(entry.file));
  await expect(page.getByRole('heading', { name: 'Résultat de l’analyse' })).toBeVisible();
  await page.locator('#clip-title').fill(entry.title);
  for (const tag of entry.tags) {
    await page.locator('#clip-tag').fill(tag);
    await page.locator('#clip-tag').press('Enter');
  }
  if (entry.visibility === 'public') await page.locator('.visibility-field').getByLabel('Public').check();
  await page.getByRole('button', { name: 'Enregistrer dans le Studio' }).click();
  await expect(page.locator('.created')).toContainText(entry.title);
}

async function videosReady(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (expected) => [...document.querySelectorAll('video')].filter((video) => video.readyState >= 2).length >= expected,
    count,
  );
}

async function ingestLibrary(page: Page, theme: Theme): Promise<void> {
  await page.goto('/clips');
  await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
  await expect(page.locator('.stat-clips')).toHaveText('0');
  await shoot(page, theme, '02-studio-vide');

  const [first, ...others] = IMPORTS;
  await page.locator('#clip-file').setInputFiles(samplePath(first.file));
  await page.waitForFunction(
    (minimum) => (document.querySelector<HTMLProgressElement>('.analysis-progress')?.value ?? 0) >= minimum,
    LIVE_PROGRESS_PERCENT,
    { polling: 'raf' },
  );
  const importCard = page.locator('section.import-card');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.addStyleTag({ content: '.app-header { position: static !important; }' });
  await importCard.screenshot({ path: `${OUTPUT_DIR}/03-import-analyse-direct-${theme}.png` });

  await expect(page.getByRole('heading', { name: 'Résultat de l’analyse' })).toBeVisible();
  await page.locator('#clip-title').fill(first.title);
  await shoot(page, theme, '04-import-resultat', importCard);
  await importClip(page, first, true);
  for (const entry of others) await importClip(page, entry);
}

async function captureDetail(page: Page, theme: Theme, api: CaptureApi): Promise<void> {
  const clip = api.clips.find((candidate) => candidate.originalName === TRAILER);
  if (!clip) throw new Error('Extrait de la bande-annonce introuvable dans la bibliothèque simulée.');
  const { durationSec } = clip.analysis;
  api.seedAnnotations(clip, [
    { time: durationSec * 0.12, text: 'Belle ouverture, le premier plan respire.', friendIndex: 0 },
    { time: durationSec * 0.46, text: 'Le rythme s’accélère ici : parfait sur le beat.', friendIndex: 2 },
    { time: durationSec * 0.83, text: 'Trop de coupes dans cette séquence ?', friendIndex: 1 },
  ]);

  await openInApp(page, `/clips/${clip.id}`);
  await expect(page.getByRole('heading', { level: 1, name: clip.title })).toBeVisible();
  await videosReady(page, 1);
  await page.evaluate(
    (time) =>
      new Promise<void>((resolveSeek) => {
        const video = document.querySelector('video') as HTMLVideoElement;
        video.addEventListener('seeked', () => resolveSeek(), { once: true });
        video.currentTime = time;
      }),
    durationSec * 0.3,
  );
  await page.locator('#annotation-text').fill('Raccord mouvement réussi, à garder.');
  await page.locator('.add-annotation').click();
  await expect(page.locator('.annotation-list .annotation')).toHaveCount(4);
  await page.locator('app-shot-histogram').scrollIntoViewIfNeeded();
  await shoot(page, theme, '06-salle-de-montage');
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole('button', { name: 'Partager' }).click();
  const dialog = page.locator('mat-dialog-container');
  await expect(dialog).toBeVisible();
  await dialog.getByText('Partagé avec des amis').click();
  await dialog.getByRole('checkbox', { name: /Alice Martin/ }).check();
  await dialog.getByRole('checkbox', { name: /Karim Benali/ }).check();
  await settle(page);
  await page.screenshot({ path: `${OUTPUT_DIR}/07-partage-${theme}.png` });
  await dialog.locator('.share-save').click();
  await expect(dialog).toBeHidden();
}

async function captureCompare(page: Page, theme: Theme, api: CaptureApi): Promise<void> {
  const [a, b] = [api.clips[api.clips.length - 1], api.clips[api.clips.length - 2]];
  await openInApp(page, `/clips/compare?a=${a.id}&b=${b.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Comparer deux montages' })).toBeVisible();
  await videosReady(page, 2);
  await page.locator('.scrub input[type="range"]').fill('3');
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every((video) => !video.seeking));
  await shoot(page, theme, '08-comparaison');
}

test.describe('Captures du rapport Film Pulse', () => {
  for (const theme of THEMES) {
    test(`parcours complet en thème ${theme}`, async ({ browser }) => {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const contextOptions = { viewport: VIEWPORT, colorScheme: theme, reducedMotion: 'reduce', locale: 'fr-FR' } as const;
      const logNetwork = theme === THEMES[0];

      const anonymous = await browser.newContext(contextOptions);
      const loginPage = await anonymous.newPage();
      await new CaptureApi({ theme, authenticated: false, logNetwork: false }).install(loginPage);
      await loginPage.goto('/login');
      await expect(loginPage.getByRole('heading', { level: 1, name: 'Connexion' })).toBeVisible();
      await shoot(loginPage, theme, '01-connexion');
      await anonymous.close();

      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const api = new CaptureApi({ theme, authenticated: true, logNetwork });
      await api.install(page);

      await ingestLibrary(page, theme);
      api.seedCommunity();

      await page.goto('/clips');
      await expect(page.locator('.stat-clips')).toHaveText(String(IMPORTS.length));
      await expect(page.locator('app-clip-card')).not.toHaveCount(0);
      await shoot(page, theme, '05-studio-bibliotheque');

      await captureDetail(page, theme, api);
      await captureCompare(page, theme, api);

      await page.goto('/discover');
      await expect(page.locator('app-clip-card')).not.toHaveCount(0);
      await shoot(page, theme, '09-decouvrir');
      await page.getByRole('tab', { name: 'Classements' }).click();
      await expect(page.locator('table.ranking')).toHaveCount(2);
      await shoot(page, theme, '10-decouvrir-classements');

      await page.goto('/friends');
      await expect(page.locator('.feed .event')).toHaveCount(5);
      await shoot(page, theme, '11-amis');

      await page.goto('/tracks');
      await expect(page.locator('.track-card')).toHaveCount(5);
      await shoot(page, theme, '12-bandes-son');

      await page.goto('/profile');
      await expect(page.getByTestId('profile-name')).toBeVisible();
      await shoot(page, theme, '13-profil');

      expect(api.unhandled).toEqual([]);
      expect(api.consoleErrors).toEqual([]);
      if (logNetwork) {
        networkLog = api.requests;
        writeNetworkReport(networkLog);
      }
      await context.close();
    });
  }
});

function writeNetworkReport(requests: LoggedRequest[]): void {
  const rows = new Map<string, { request: LoggedRequest; count: number }>();
  for (const request of requests) {
    const key = `${request.method} ${request.url} ${request.status}`;
    const row = rows.get(key);
    if (row) row.count++;
    else rows.set(key, { request, count: 1 });
  }
  const lines = [...rows.values()].map(
    ({ request, count }) => `| ${request.method} | \`${request.url}\` | ${request.status} | ${count} | ${request.role} |`,
  );
  const document = [
    '# Requêtes /api du parcours de captures',
    '',
    '> **API simulée par Playwright (contrat identique au backend), ce n’est PAS une capture DevTools d’un vrai serveur.**',
    '',
    `Table générée par \`e2e/captures.spec.ts\` à partir des événements \`request\`/\`response\` de Playwright, pendant le parcours complet en thème sombre (${requests.length} requêtes, ${rows.size} distinctes). Les statuts sont ceux renvoyés par l’API simulée. Relancer : \`npm run captures\`.`,
    '',
    '| Méthode | URL | Statut | Occurrences | Rôle |',
    '|---|---|---|---|---|',
    ...lines,
    '',
  ].join('\n');
  writeFileSync(`${OUTPUT_DIR}/NETWORK-API-SIMULEE.md`, document);
}
