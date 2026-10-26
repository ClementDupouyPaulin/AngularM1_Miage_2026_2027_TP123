/** Fenêtre glissante de la densité de coupes (s), imposée par le cahier des charges. */
export const DENSITY_WINDOW_SEC = 5;
/** Fenêtre de la courbe d'accélération (s). */
export const ACCELERATION_WINDOW_SEC = 10;
/** Nombre d'échantillons de la courbe : assez pour un tracé lisse, peu de nœuds SVG. */
export const PULSE_SAMPLES = 200;
/** Plafond de points de la courbe d'accélération (un par seconde en dessous). */
export const MAX_ACCELERATION_POINTS = 300;
/** Rayon (en échantillons) de la moyenne glissante qui lisse le pouls. */
export const SMOOTHING_RADIUS = 3;
/** Pas clavier : flèches = 1 s, Page précédente/suivante = 10 s. */
export const KEY_STEP_SEC = 1;
export const PAGE_STEP_SEC = 10;
/** Taille native d'une cellule du sprite de la pellicule (px), cellules côte à côte. */
export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 90;
/** Pas « ronds » candidats pour les graduations de l'axe (s). */
const TICK_STEPS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MAX_TICKS = 8;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface ShotBin {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface SeriesPoint {
  time: number;
  count: number;
}

export interface PaletteStop {
  offset: number;
  color: string;
}

/** Classes de durée de plan (s) : bornes `[min, max[`. */
export const SHOT_BIN_BOUNDS: readonly { label: string; min: number; max: number }[] = [
  { label: '0–1 s', min: 0, max: 1 },
  { label: '1–2 s', min: 1, max: 2 },
  { label: '2–4 s', min: 2, max: 4 },
  { label: '4–8 s', min: 4, max: 8 },
  { label: '8 s +', min: 8, max: Number.POSITIVE_INFINITY },
];

/** Ramène une valeur dans `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Position relative `[0, 1]` d'un instant ; 0 si la durée est invalide. */
export function timeToRatio(timeSec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return clamp(timeSec / durationSec, 0, 1);
}

/** Instant correspondant à une position relative, borné à `[0, durée]`. */
export function ratioToTime(ratio: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return clamp(ratio, 0, 1) * durationSec;
}

/** « m:ss » (secondes tronquées), pour `aria-valuetext`. */
export function formatTime(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** « m:ss,d » : une coupe se situe au dixième de seconde près. */
export function formatPreciseTime(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const tenths = Math.round(safe * 10);
  return `${formatTime(Math.floor(tenths / 10))},${tenths % 10}`;
}

/** Code temporel affiché en police mono : « 00:12 », « 00:12,4 », « 01:02:05 » au-delà d'une heure. */
export function formatTimecode(sec: number, precise = false): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const tenths = precise ? Math.round(safe * 10) : Math.floor(safe) * 10;
  const total = Math.floor(tenths / 10);
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => value.toString().padStart(2, '0');
  const clock = `${hours > 0 ? `${pad(hours)}:` : ''}${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  return precise ? `${clock},${tenths % 10}` : clock;
}

/**
 * Nombre de coupes dans une fenêtre de `windowSec` centrée sur chacun des
 * `samples + 1` instants régulièrement répartis de 0 à la durée.
 */
export function cutDensity(
  cuts: readonly number[],
  durationSec: number,
  samples = PULSE_SAMPLES,
  windowSec = DENSITY_WINDOW_SEC,
): number[] {
  if (!(durationSec > 0) || samples < 1) return [];
  const half = windowSec / 2;
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = (i / samples) * durationSec;
    return cuts.filter((cut) => cut >= t - half && cut < t + half).length;
  });
}

/** Moyenne glissante de rayon `radius` (fenêtre tronquée aux bords). */
export function smooth(values: readonly number[], radius = SMOOTHING_RADIUS): number[] {
  if (radius <= 0) return [...values];
  return values.map((_, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += values[j];
    return sum / (to - from + 1);
  });
}

/** Densité de coupes lissée : la courbe du « pouls ». */
export function densitySeries(
  cuts: readonly number[],
  durationSec: number,
  samples = PULSE_SAMPLES,
): number[] {
  return smooth(cutDensity(cuts, durationSec, samples));
}

/** Points `[x, y]` d'une série dans la bande `[top, bottom]` ; `maxValue` = sommet de l'échelle. */
export function pulsePoints(
  values: readonly number[],
  maxValue: number,
  width = 1000,
  top = 8,
  bottom = 112,
): [number, number][] {
  if (values.length === 0) return [];
  const scale = maxValue > 0 ? maxValue : 1;
  const last = Math.max(1, values.length - 1);
  return values.map((value, i) => [
    round2((i / last) * width),
    round2(bottom - clamp(value / scale, 0, 1) * (bottom - top)),
  ]);
}

/** Chemin SVG `M… L…` reliant des points. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

/** Graduations de l'axe : pas rond le plus fin donnant au plus `maxTicks` intervalles. */
export function axisTicks(durationSec: number, maxTicks = MAX_TICKS): number[] {
  if (!(durationSec > 0)) return [0];
  const step =
    TICK_STEPS_SEC.find((candidate) => durationSec / candidate <= maxTicks) ??
    Math.ceil(durationSec / maxTicks / 60) * 60;
  const ticks: number[] = [];
  for (let t = 0; t <= durationSec + 1e-9; t += step) ticks.push(t);
  return ticks;
}

/** Durées des plans : n coupes strictement dans `]0, durée[` donnent n + 1 plans. */
export function shotLengths(cuts: readonly number[], durationSec: number): number[] {
  if (!(durationSec > 0)) return [];
  const inside = cuts.filter((cut) => cut > 0 && cut < durationSec).sort((a, b) => a - b);
  const bounds = [0, ...inside, durationSec];
  const lengths: number[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const length = bounds[i] - bounds[i - 1];
    if (length > 0) lengths.push(round2(length));
  }
  return lengths;
}

/** Répartition des durées de plan dans les classes `SHOT_BIN_BOUNDS`. */
export function histogramBins(lengths: readonly number[]): ShotBin[] {
  return SHOT_BIN_BOUNDS.map((bin) => ({
    ...bin,
    count: lengths.filter((length) => length >= bin.min && length < bin.max).length,
  }));
}

/** Coupes par fenêtre glissante centrée (`windowSec`) au fil du film, environ un point par seconde. */
export function accelerationSeries(
  cuts: readonly number[],
  durationSec: number,
  windowSec = ACCELERATION_WINDOW_SEC,
): SeriesPoint[] {
  if (!(durationSec > 0)) return [];
  const samples = clamp(Math.ceil(durationSec), 1, MAX_ACCELERATION_POINTS);
  const counts = cutDensity(cuts, durationSec, samples, windowSec);
  return counts.map((count, i) => ({ time: round2((i / samples) * durationSec), count }));
}

/** Indice de la vignette la plus proche de `t` (la plus ancienne en cas d'égalité), -1 si aucune. */
export function nearestThumbnailIndex(times: readonly number[], t: number): number {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  times.forEach((time, i) => {
    const gap = Math.abs(time - t);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

/** Indice de la vignette du plan en cours : dernière vignette dont l'instant est ≤ `t`. */
export function activeThumbnailIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let active = 0;
  times.forEach((time, i) => {
    if (time <= t) active = i;
  });
  return active;
}

/** `background-position` d'une cellule du sprite (cellules 160×90 alignées horizontalement). */
export function spritePosition(index: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  return `${safe === 0 ? 0 : -safe * THUMB_WIDTH}px 0px`;
}

/** Valeur CSS `url("…")` pour un ObjectURL ; `none` si vide. Les guillemets sont échappés. */
export function cssUrl(url: string): string {
  if (!url) return 'none';
  return `url("${url.replace(/[\\"]/g, '\\$&').replace(/[\n\r]/g, '')}")`;
}

/** Arrêts du dégradé de palette : une couleur par seconde, centrée sur sa seconde ; couleurs invalides ignorées. */
export function paletteStops(palette: readonly string[]): PaletteStop[] {
  const count = palette.length;
  return palette.flatMap((color, i) =>
    HEX_COLOR.test(color) ? [{ offset: round2(((i + 0.5) / count) * 100), color }] : [],
  );
}

/** Cible d'un déplacement clavier de type `slider`, ou `null` si la touche n'en est pas un. */
export function keyboardSeekTarget(key: string, now: number, end: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(now + KEY_STEP_SEC, 0, end);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(now - KEY_STEP_SEC, 0, end);
    case 'PageUp':
      return clamp(now + PAGE_STEP_SEC, 0, end);
    case 'PageDown':
      return clamp(now - PAGE_STEP_SEC, 0, end);
    case 'Home':
      return 0;
    case 'End':
      return end;
    default:
      return null;
  }
}

/** Nombre formaté en français avec au plus une décimale. */
export function formatNumber(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
