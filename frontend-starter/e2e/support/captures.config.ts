import { defineConfig } from '@playwright/test';

const BASE_URL = process.env['CAPTURES_URL'] ?? 'http://localhost:4200';

/** Projet séparé de la suite `e2e` : réutilise le serveur de dev déjà lancé, ne prend que captures.spec.ts. */
export default defineConfig({
  testDir: '..',
  testMatch: 'captures.spec.ts',
  timeout: 600_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // Le Chromium de Playwright n'embarque ni H.264 ni AAC : Google Chrome lit les MP4.
    channel: 'chrome',
  },
  webServer: {
    command: 'npx ng serve --port 4200',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
