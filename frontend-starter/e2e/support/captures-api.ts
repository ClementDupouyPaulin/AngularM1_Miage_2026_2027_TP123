import { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { MockAnalysis } from './api-mock';
import { samplePath } from './samples';

const TOKEN_KEY = 'gpc_token';
const THEME_KEY = 'film-pulse-theme';
const SPARKLINE_BUCKETS = 24;
const MINUTE_MS = 60_000;

const ME = { id: 'user-me', name: 'Clara Moreau', email: 'clara.moreau@example.com', createdAt: '2026-03-14T09:30:00.000Z' };
const FRIENDS = [
  { id: 'u-alice', name: 'Alice Martin', email: 'alice.martin@example.com' },
  { id: 'u-karim', name: 'Karim Benali', email: 'karim.benali@example.com' },
  { id: 'u-lea', name: 'Léa Fontaine', email: 'lea.fontaine@example.com' },
];
const STRANGERS = [
  { id: 'u-nina', name: 'Nina Okafor' },
  { id: 'u-theo', name: 'Théo Garnier' },
  { id: 'u-ines', name: 'Inès Duval' },
  { id: 'u-marc', name: 'Marc Lefèvre' },
  { id: 'u-sam', name: 'Sam Petit' },
];

type Visibility = 'private' | 'shared' | 'public';
type Audience = 'public' | 'friends' | 'shared';
interface Person { id: string; name: string }
interface Annotation { id: string; time: number; text: string; authorId: string; authorName: string; createdAt: string }

export interface StoredClip {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  analysis: MockAnalysis;
  syncScore: number | null;
  createdAt: string;
  tags: string[];
  visibility: Visibility;
  owner: Person;
  isOwner: boolean;
  filmstrip: Buffer | null;
  annotations: Annotation[];
  sharedWith: Person[];
  /** Renseigné seulement pour les extraits des autres utilisateurs. */
  audience?: Audience;
}

export interface LoggedRequest {
  method: string;
  url: string;
  status: number;
  role: string;
}

interface Part { name: string; filename?: string; data: Buffer }

const ROLES: { method: string; pattern: RegExp; role: string }[] = [
  { method: 'GET', pattern: /^\/api\/users\/me$/, role: 'Profil de l’utilisateur connecté' },
  { method: 'GET', pattern: /^\/api\/clips$/, role: 'Bibliothèque paginée (Studio, comparaison)' },
  { method: 'GET', pattern: /^\/api\/clips\/stats$/, role: 'Tableau de bord du Studio' },
  { method: 'GET', pattern: /^\/api\/clips\/tags$/, role: 'Étiquettes et compteurs (filtres)' },
  { method: 'GET', pattern: /^\/api\/clips\/discover$/, role: 'Découvrir : extraits publics, amis, partagés, classements' },
  { method: 'GET', pattern: /^\/api\/clips\/[^/]+\/filmstrip$/, role: 'Pellicule (JPEG) d’un extrait' },
  { method: 'GET', pattern: /^\/api\/clips\/[^/]+\/video$/, role: 'Octets de la vidéo (lecteur)' },
  { method: 'GET', pattern: /^\/api\/clips\/[^/]+$/, role: 'Détail d’un extrait avec son analyse' },
  { method: 'POST', pattern: /^\/api\/clips$/, role: 'Enregistrement d’un extrait (multipart : vidéo, analyse, pellicule)' },
  { method: 'PATCH', pattern: /^\/api\/clips\/[^/]+$/, role: 'Réglage du partage (visibilité, amis)' },
  { method: 'POST', pattern: /^\/api\/clips\/[^/]+\/annotations$/, role: 'Ajout d’une annotation sur la timeline' },
  { method: 'GET', pattern: /^\/api\/friends$/, role: 'Amis et invitations' },
  { method: 'GET', pattern: /^\/api\/activity$/, role: 'Fil d’activité' },
  { method: 'GET', pattern: /^\/api\/tracks$/, role: 'Bandes-son paginées' },
  { method: 'GET', pattern: /^\/api\/tracks\/[^/]+\/cover$/, role: 'Pochette d’une bande-son' },
];

function roleOf(method: string, pathname: string): string {
  return ROLES.find((entry) => entry.method === method && entry.pattern.test(pathname))?.role ?? 'Non simulée';
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

function summary(clip: StoredClip) {
  const { analysis } = clip;
  return {
    id: clip.id,
    title: clip.title,
    originalName: clip.originalName,
    mimeType: clip.mimeType,
    size: clip.size,
    durationSec: analysis.durationSec,
    cutCount: analysis.cuts.length,
    avgShotLength: analysis.durationSec / (analysis.cuts.length + 1),
    syncScore: clip.syncScore,
    createdAt: clip.createdAt,
    tags: clip.tags,
    visibility: clip.visibility,
    owner: clip.owner,
    isOwner: clip.isOwner,
    hasFilmstrip: clip.filmstrip !== null,
    sparkline: sparkline(analysis.cuts, analysis.durationSec),
  };
}

function detail(clip: StoredClip) {
  return {
    ...summary(clip),
    analysis: { ...clip.analysis, syncScore: clip.syncScore },
    annotations: clip.annotations,
    sharedWith: clip.isOwner ? clip.sharedWith : [],
  };
}

function pageOf<T>(items: T[], page: number, limit: number) {
  const pages = Math.max(1, Math.ceil(items.length / limit));
  return {
    items: items.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: items.length,
    pages,
    hasPrevPage: page > 1,
    hasNextPage: page < pages,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page < pages ? page + 1 : null,
  };
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function coverSvg(hue: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,28%)"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="60" r="26" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="6"/><circle cx="60" cy="60" r="7" fill="rgba(255,255,255,.75)"/></svg>`;
}

const TRACKS = [
  { title: 'Calm sketch for piano', artist: 'Studio Pulse', album: 'Esquisses', file: 'song10-calm-sketch-for-piano.mp3', cover: 210 },
  { title: 'Cartoon pizzicato', artist: 'Studio Pulse', album: 'Dessins animés', file: 'song11-cartoon-pizzicato.mp3', cover: 30 },
  { title: 'Chase pulse (faster)', artist: 'Studio Pulse', album: 'Poursuites', file: 'song12-chase-pulse-faster.mp3', cover: 350 },
  { title: '120 monster', artist: null, album: null, file: 'song3-120-monster.mp3', cover: null },
  { title: '80s smooth rocker', artist: 'Neon Reel', album: 'Années 80', file: 'song4-80s-smooth-rocker.mp3', cover: 290 },
  { title: 'A little faith', artist: null, album: null, file: 'song5-a-little-faith.mp3', cover: null },
  { title: 'Ambiant anxiety', artist: 'Neon Reel', album: 'Tension', file: 'song6-ambiant-anxiety.mp3', cover: 150 },
].map((track, index) => ({
  id: `track-${index + 1}`,
  title: track.title,
  originalName: track.file,
  mimeType: 'audio/mpeg',
  size: 2_400_000 + index * 310_000,
  createdAt: minutesAgo(60 * 24 * (index + 1)),
  artist: track.artist,
  album: track.album,
  hasCover: track.cover !== null,
  coverSource: track.cover !== null ? ('id3' as const) : null,
  hue: track.cover,
}));

export interface CaptureApiOptions {
  theme: 'dark' | 'light';
  authenticated: boolean;
  /** Vrai : les requêtes /api sont consignées pour le tableau réseau. */
  logNetwork: boolean;
}

/** API simulée riche (amis, activité, extraits d'autres utilisateurs, bandes-son) pour les captures du rapport. */
export class CaptureApi {
  readonly clips: StoredClip[] = [];
  readonly community: StoredClip[] = [];
  readonly requests: LoggedRequest[] = [];
  readonly consoleErrors: string[] = [];
  readonly unhandled: string[] = [];

  constructor(private readonly options: CaptureApiOptions) {}

  async install(page: Page): Promise<void> {
    const { theme, authenticated } = this.options;
    await page.addInitScript(
      ([tokenKey, themeKey, themeValue, withToken]) => {
        localStorage.setItem(themeKey, themeValue);
        if (withToken === 'yes') localStorage.setItem(tokenKey, 'capture-token');
      },
      [TOKEN_KEY, THEME_KEY, theme, authenticated ? 'yes' : 'no'],
    );
    page.on('console', (message) => {
      if (message.type() === 'error') this.consoleErrors.push(`${message.text()} ${message.location().url}`);
    });
    page.on('pageerror', (error) => this.consoleErrors.push(error.message));
    if (this.options.logNetwork) {
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (!url.pathname.startsWith('/api/')) return;
        const method = response.request().method();
        this.requests.push({ method, url: url.pathname + url.search, status: response.status(), role: roleOf(method, url.pathname) });
      });
    }
    await page.route((url) => url.pathname.startsWith('/api/'), (route) => this.handle(route));
  }

  /** Extraits des autres utilisateurs, dérivés des analyses réelles de la bibliothèque. */
  seedCommunity(): void {
    const sources = this.clips;
    let created = 0;
    const make = (index: number, title: string, owner: Person, audience: Audience, tags: string[], sync: number | null): StoredClip => {
      const source = sources[index % sources.length];
      created++;
      return {
        ...source,
        id: `other-${created}`,
        title,
        owner,
        isOwner: false,
        audience,
        visibility: audience === 'public' ? 'public' : 'shared',
        tags,
        syncScore: sync,
        annotations: [],
        sharedWith: [],
        createdAt: minutesAgo(90 + created * 340),
      };
    };
    this.community.push(
      make(3, 'Poursuite de nuit', STRANGERS[0], 'public', ['action', 'nuit'], 1.42),
      make(4, 'Montage nerveux 4K', STRANGERS[1], 'public', ['clip', 'rapide'], 1.18),
      make(1, 'Plan contemplatif', STRANGERS[2], 'public', ['calme'], 0.97),
      make(2, 'Duel final', STRANGERS[3], 'public', ['western'], 1.31),
      make(0, 'Générique de fin', STRANGERS[4], 'public', ['générique'], 1.05),
      make(4, 'Teaser du festival', FRIENDS[0], 'friends', ['festival'], 1.22),
      make(3, 'Répétition générale', FRIENDS[1], 'friends', ['coulisses'], 1.09),
      make(4, 'Version longue annotée', FRIENDS[2], 'shared', ['relecture'], 1.37),
    );
  }

  private all(): StoredClip[] {
    return [...this.clips, ...this.community];
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const method = request.method();
    const num = (name: string, fallback: number) => Number(searchParams.get(name)) || fallback;

    if (method === 'GET' && pathname === '/api/users/me') return json(route, ME);
    if (method === 'GET' && pathname === '/api/clips/stats') return json(route, this.stats());
    if (method === 'GET' && pathname === '/api/clips/tags') return json(route, this.tagCounts());
    if (method === 'GET' && pathname === '/api/clips/discover') return json(route, this.discover(searchParams, num('page', 1), num('limit', 12)));
    if (method === 'GET' && pathname === '/api/clips') return json(route, this.list(searchParams, num('page', 1), num('limit', 6)));
    if (method === 'POST' && pathname === '/api/clips') return this.create(route);
    if (method === 'GET' && pathname === '/api/friends') return json(route, this.friends());
    if (method === 'GET' && pathname === '/api/activity') return json(route, this.activity());

    const clipMatch = /^\/api\/clips\/([^/]+)(?:\/(video|filmstrip|annotations))?$/.exec(pathname);
    if (clipMatch) {
      const clip = this.all().find((candidate) => candidate.id === clipMatch[1]);
      if (!clip) return json(route, { message: 'Extrait introuvable.' }, 404);
      const [, , sub] = clipMatch;
      if (method === 'GET' && !sub) return json(route, detail(clip));
      if (method === 'GET' && sub === 'video') {
        const body = readFileSync(samplePath(clip.originalName));
        return route.fulfill({ status: 200, contentType: clip.mimeType, body });
      }
      if (method === 'GET' && sub === 'filmstrip') {
        if (!clip.filmstrip) return json(route, { message: 'Pas de pellicule.' }, 404);
        return route.fulfill({ status: 200, contentType: 'image/jpeg', body: clip.filmstrip });
      }
      if (method === 'PATCH' && !sub) return this.patch(route, clip);
      if (method === 'POST' && sub === 'annotations') return this.annotate(route, clip);
    }

    if (method === 'GET' && pathname === '/api/tracks') return json(route, this.tracks(searchParams, num('page', 1), num('limit', 5)));
    const cover = /^\/api\/tracks\/([^/]+)\/cover$/.exec(pathname);
    if (method === 'GET' && cover) {
      const track = TRACKS.find((candidate) => candidate.id === cover[1]);
      if (!track || track.hue === null) return json(route, { message: 'Pas de pochette.' }, 404);
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: coverSvg(track.hue) });
    }

    this.unhandled.push(`${method} ${pathname}`);
    return json(route, { message: 'Route non simulée' }, 404);
  }

  private list(params: URLSearchParams, page: number, limit: number) {
    const q = params.get('q')?.toLowerCase();
    const tag = params.get('tag');
    const visibility = params.get('visibility');
    const items = this.clips
      .filter((clip) => !q || clip.title.toLowerCase().includes(q) || clip.originalName.toLowerCase().includes(q))
      .filter((clip) => !tag || clip.tags.includes(tag))
      .filter((clip) => !visibility || clip.visibility === visibility);
    return pageOf(items.map(summary), page, limit);
  }

  private discover(params: URLSearchParams, page: number, limit: number) {
    const scope = params.get('scope') ?? 'public';
    const sort = params.get('sort') ?? 'recent';
    const items = this.community.filter((clip) => clip.audience === scope);
    if (sort === 'nervous') items.sort((a, b) => summary(a).avgShotLength - summary(b).avgShotLength);
    if (sort === 'synced') items.sort((a, b) => (b.syncScore ?? 0) - (a.syncScore ?? 0));
    if (sort === 'recent') items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return pageOf(items.map(summary), page, limit);
  }

  private stats() {
    const rows = this.clips.map(summary);
    const totalCuts = rows.reduce((sum, row) => sum + row.cutCount, 0);
    const totalDuration = rows.reduce((sum, row) => sum + row.durationSec, 0);
    const byVisibility = { private: 0, shared: 0, public: 0 };
    for (const row of rows) byVisibility[row.visibility]++;
    const nervous = [...rows].sort((a, b) => a.avgShotLength - b.avgShotLength)[0] ?? null;
    const synced = [...rows].filter((row) => row.syncScore !== null).sort((a, b) => (b.syncScore ?? 0) - (a.syncScore ?? 0))[0] ?? null;
    return {
      clipCount: rows.length,
      totalDurationSec: totalDuration,
      totalCuts,
      avgShotLength: rows.length ? totalDuration / (totalCuts + rows.length) : null,
      mostNervous: nervous,
      mostSynced: synced,
      byVisibility,
    };
  }

  private tagCounts() {
    const counts = new Map<string, number>();
    for (const clip of this.clips) for (const tag of clip.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  private friends() {
    return {
      friends: FRIENDS.map((user, index) => ({ friendshipId: `fs-${index + 1}`, user, since: minutesAgo(60 * 24 * 30 * (index + 1)) })),
      requests: [
        { id: 'rq-1', user: { id: 'u-hugo', name: 'Hugo Leroy', email: 'hugo.leroy@example.com' }, direction: 'incoming', createdAt: minutesAgo(35) },
        { id: 'rq-2', user: { id: 'u-sofia', name: 'Sofia Rossi', email: 'sofia.rossi@example.com' }, direction: 'outgoing', createdAt: minutesAgo(60 * 26) },
      ],
    };
  }

  private activity() {
    const [first, second, third] = this.community.filter((clip) => clip.audience !== 'public');
    return [
      { id: 'ev-1', type: 'clip', actor: { id: FRIENDS[0].id, name: FRIENDS[0].name }, clipId: first?.id, clipTitle: first?.title, at: minutesAgo(18) },
      { id: 'ev-2', type: 'annotation', actor: { id: FRIENDS[2].id, name: FRIENDS[2].name }, clipId: third?.id, clipTitle: third?.title, text: 'Le raccord à 0:04 fonctionne très bien.', at: minutesAgo(95) },
      { id: 'ev-3', type: 'clip', actor: { id: FRIENDS[1].id, name: FRIENDS[1].name }, clipId: second?.id, clipTitle: second?.title, at: minutesAgo(60 * 5) },
      { id: 'ev-4', type: 'friend', actor: { id: FRIENDS[2].id, name: FRIENDS[2].name }, at: minutesAgo(60 * 28) },
      { id: 'ev-5', type: 'annotation', actor: { id: FRIENDS[0].id, name: FRIENDS[0].name }, clipId: this.clips[0]?.id, clipTitle: this.clips[0]?.title, text: 'Trop de coupes dans la dernière minute ?', at: minutesAgo(60 * 49) },
    ];
  }

  private tracks(params: URLSearchParams, page: number, limit: number) {
    const q = params.get('q')?.toLowerCase();
    const items = TRACKS.filter((track) => !q || track.title.toLowerCase().includes(q)).map(({ hue: _hue, ...track }) => track);
    return pageOf(items, page, limit);
  }

  private create(route: Route): Promise<void> {
    const request = route.request();
    const parts = parseMultipart(request.postDataBuffer() ?? Buffer.alloc(0), request.headers()['content-type'] ?? '');
    const fields: Record<string, string> = {};
    const files: Record<string, { filename: string; data: Buffer }> = {};
    for (const part of parts) {
      if (part.filename === undefined) fields[part.name] = part.data.toString('utf8');
      else files[part.name] = { filename: part.filename, data: part.data };
    }
    const analysis = JSON.parse(fields['analysis'] ?? 'null') as MockAnalysis;
    const video = files['video'];
    const clip: StoredClip = {
      id: `clip-${this.clips.length + 1}`,
      title: fields['title'],
      originalName: basename(video.filename),
      mimeType: video.filename.endsWith('.webm') ? 'video/webm' : 'video/mp4',
      size: video.data.length,
      analysis,
      syncScore: analysis.syncScore,
      createdAt: new Date().toISOString(),
      tags: fields['tags'] ? (JSON.parse(fields['tags']) as string[]) : [],
      visibility: (fields['visibility'] as Visibility) ?? 'private',
      owner: { id: ME.id, name: ME.name },
      isOwner: true,
      filmstrip: files['filmstrip']?.data ?? null,
      annotations: [],
      sharedWith: [],
    };
    this.clips.unshift(clip);
    return json(route, detail(clip), 201);
  }

  private patch(route: Route, clip: StoredClip): Promise<void> {
    const body = route.request().postDataJSON() as { visibility?: Visibility; sharedWith?: string[]; title?: string; tags?: string[] };
    if (body.title !== undefined) clip.title = body.title;
    if (body.tags !== undefined) clip.tags = body.tags;
    if (body.visibility !== undefined) clip.visibility = body.visibility;
    if (body.sharedWith !== undefined) {
      clip.sharedWith = FRIENDS.filter((friend) => body.sharedWith?.includes(friend.id)).map(({ id, name }) => ({ id, name }));
    }
    return json(route, detail(clip));
  }

  private annotate(route: Route, clip: StoredClip): Promise<void> {
    const body = route.request().postDataJSON() as { time: number; text: string };
    const annotation: Annotation = {
      id: `ann-${clip.annotations.length + 1}`,
      time: body.time,
      text: body.text,
      authorId: ME.id,
      authorName: ME.name,
      createdAt: new Date().toISOString(),
    };
    clip.annotations.push(annotation);
    return json(route, annotation, 201);
  }

  /** Annotations déposées par des amis, pour peupler la timeline de la Salle de montage. */
  seedAnnotations(clip: StoredClip, notes: { time: number; text: string; friendIndex: number }[]): void {
    for (const note of notes) {
      const friend = FRIENDS[note.friendIndex];
      clip.annotations.push({
        id: `seed-${clip.annotations.length + 1}`,
        time: note.time,
        text: note.text,
        authorId: friend.id,
        authorName: friend.name,
        createdAt: minutesAgo(120),
      });
    }
  }
}
