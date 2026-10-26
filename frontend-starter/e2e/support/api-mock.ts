import { Page, Route } from '@playwright/test';

const TOKEN_KEY = 'gpc_token';
const SPARKLINE_BUCKETS = 24;
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const USER = { id: 'user-1', name: 'Testeuse E2E', email: 'e2e@example.com', createdAt: '2026-01-01T00:00:00.000Z' };

export interface UploadedForm {
  fields: Record<string, string>;
  files: Record<string, { filename: string; size: number }>;
  analysis: MockAnalysis;
}

export interface MockAnalysis {
  version: number;
  durationSec: number;
  fps: number;
  cuts: number[];
  beats: number[];
  syncScore: number | null;
  diffs: number[];
  palette: string[];
  transitions: { time: number; kind: 'cut' | 'fade' }[];
  thumbnailTimes: number[];
  sensitivity: number;
}

export interface MockClip {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  durationSec: number;
  cutCount: number;
  avgShotLength: number;
  syncScore: number | null;
  createdAt: string;
  tags: string[];
  visibility: string;
  owner: { id: string; name: string };
  isOwner: boolean;
  hasFilmstrip: boolean;
  sparkline: number[];
  analysis: MockAnalysis;
  annotations: never[];
  sharedWith: never[];
}

export interface ApiMock {
  uploads: UploadedForm[];
  clips: MockClip[];
  /** Requêtes /api non simulées : doivent rester vides. */
  unhandled: string[];
}

interface Part {
  name: string;
  filename?: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) throw new Error(`Content-Type multipart sans boundary : ${contentType}`);
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const raw = body.subarray(start + 2, next - 2);
    const headerEnd = raw.indexOf('\r\n\r\n');
    const headers = raw.subarray(0, headerEnd).toString('utf8');
    const disposition = /name="([^"]*)"(?:; filename="([^"]*)")?/.exec(headers);
    if (disposition) parts.push({ name: disposition[1], filename: disposition[2], data: raw.subarray(headerEnd + 4) });
    cursor = next;
  }
  return parts;
}

function sparkline(cuts: number[], durationSec: number): number[] {
  const buckets = new Array<number>(SPARKLINE_BUCKETS).fill(0);
  for (const cut of cuts) buckets[Math.min(SPARKLINE_BUCKETS - 1, Math.floor((cut / durationSec) * SPARKLINE_BUCKETS))]++;
  return buckets;
}

function toClip(id: number, form: UploadedForm): MockClip {
  const { analysis, fields, files } = form;
  const video = files['video'];
  return {
    id: `clip-${id}`,
    title: fields['title'],
    originalName: video.filename,
    mimeType: video.filename.endsWith('.webm') ? 'video/webm' : 'video/mp4',
    size: video.size,
    durationSec: analysis.durationSec,
    cutCount: analysis.cuts.length,
    avgShotLength: analysis.durationSec / (analysis.cuts.length + 1),
    syncScore: analysis.syncScore,
    createdAt: new Date().toISOString(),
    tags: fields['tags'] ? (JSON.parse(fields['tags']) as string[]) : [],
    visibility: fields['visibility'] ?? 'private',
    owner: { id: USER.id, name: USER.name },
    isOwner: true,
    hasFilmstrip: 'filmstrip' in files,
    sparkline: sparkline(analysis.cuts, analysis.durationSec),
    analysis,
    annotations: [],
    sharedWith: [],
  };
}

function pageOf<T>(items: T[]) {
  return {
    items,
    page: 1,
    limit: 12,
    total: items.length,
    pages: 1,
    hasPrevPage: false,
    hasNextPage: false,
    prevPage: null,
    nextPage: null,
  };
}

function summary({ analysis: _analysis, annotations: _annotations, sharedWith: _sharedWith, ...rest }: MockClip) {
  return rest;
}

function stats(clips: MockClip[]) {
  const totalCuts = clips.reduce((sum, clip) => sum + clip.cutCount, 0);
  const totalDuration = clips.reduce((sum, clip) => sum + clip.durationSec, 0);
  return {
    clipCount: clips.length,
    totalDurationSec: totalDuration,
    totalCuts,
    avgShotLength: clips.length ? totalDuration / (totalCuts + clips.length) : null,
    mostNervous: clips[0] ? summary(clips[0]) : null,
    mostSynced: null,
    byVisibility: { private: clips.length, shared: 0, public: 0 },
  };
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Simule toute l'API : aucun backend ni MongoDB, la session est authentifiée par un faux jeton. */
export async function installApiMock(page: Page): Promise<ApiMock> {
  const state: ApiMock = { uploads: [], clips: [], unhandled: [] };
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, 'e2e-token'),
    [TOKEN_KEY],
  );
  // Le tampon intercepté par Playwright omet les gros blobs : la vidéo réellement envoyée est mesurée dans la page.
  await page.addInitScript(() => {
    const sent: { name: string; size: number; type: string; transport: string }[] = [];
    (window as unknown as { __sentVideos: typeof sent }).__sentVideos = sent;
    const record = (body: unknown, transport: string) => {
      const video = body instanceof FormData ? body.get('video') : null;
      if (video instanceof File) sent.push({ name: video.name, size: video.size, type: video.type, transport });
    };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      record(body, 'xhr');
      return send.call(this, body);
    };
    const nativeFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      record(init?.body, 'fetch');
      return nativeFetch.call(this, input, init);
    };
  });

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const method = request.method();

      if (method === 'GET' && pathname === '/api/users/me') return json(route, USER);
      if (method === 'GET' && pathname === '/api/clips') return json(route, pageOf(state.clips.map(summary)));
      if (method === 'GET' && pathname === '/api/clips/stats') return json(route, stats(state.clips));
      if (method === 'GET' && pathname === '/api/clips/tags') return json(route, []);
      if (method === 'GET' && pathname === '/api/clips/discover') return json(route, pageOf([]));
      if (method === 'GET' && pathname === '/api/friends') return json(route, { friends: [], requests: [] });
      if (method === 'GET' && pathname === '/api/activity') return json(route, []);

      if (method === 'GET' && /^\/api\/clips\/[^/]+\/filmstrip$/.test(pathname)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
      }

      if (method === 'POST' && pathname === '/api/clips') {
        const parts = parseMultipart(request.postDataBuffer() ?? Buffer.alloc(0), request.headers()['content-type'] ?? '');
        const fields: Record<string, string> = {};
        const files: UploadedForm['files'] = {};
        for (const part of parts) {
          if (part.filename === undefined) fields[part.name] = part.data.toString('utf8');
          else files[part.name] = { filename: part.filename, size: part.data.length };
        }
        const form: UploadedForm = {
          fields,
          files,
          analysis: JSON.parse(fields['analysis'] ?? 'null') as MockAnalysis
        };
        state.uploads.push(form);
        const clip = toClip(state.uploads.length, form);
        state.clips.unshift(clip);
        return json(route, clip, 201);
      }

      state.unhandled.push(`${method} ${pathname}`);
      return json(route, { message: 'Route non simulée' }, 404);
    },
  );
  return state;
}
