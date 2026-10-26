import { ClipAnalysis } from '../../shared/models/clip.model';
import { densitySeries, formatTimecode, timeToRatio } from '../pulse-timeline/chart-math';

export const EXPORT_WIDTH = 1600;
export const EXPORT_HEIGHT = 900;
const PADDING = 64;
const TITLE_MAX_CHARS = 60;
const SLUG_MAX_CHARS = 60;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Bandes verticales de l'image (px). */
const LAYOUT = {
  titleY: PADDING,
  paletteTop: 170,
  paletteHeight: 36,
  plotTop: 240,
  plotBottom: 680,
  beatTop: 712,
  beatBottom: 764,
  footerY: 820,
} as const;

/** Couleurs et polices du thème courant, lues sur les variables CSS calculées. */
export interface ExportTheme {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  cut: string;
  fade: string;
  beat: string;
  fontSans: string;
  fontMono: string;
}

/**
 * Valeurs du thème sombre, utilisées seulement si une variable CSS est absente
 * (page hors application, tests) : le canvas ne sait pas lire `var(--…)`.
 */
const FALLBACK_THEME: ExportTheme = {
  background: '#0b0c10',
  surface: '#14161c',
  text: '#eceef3',
  muted: '#a3a9b8',
  accent: '#f5a524',
  cut: '#ff4d4d',
  fade: '#b48cff',
  beat: '#35d0ff',
  fontSans: 'system-ui, sans-serif',
  fontMono: 'ui-monospace, monospace',
};

const THEME_VARIABLES: Readonly<Record<keyof ExportTheme, string>> = {
  background: '--bg',
  surface: '--surface',
  text: '--text',
  muted: '--text-muted',
  accent: '--accent',
  cut: '--rec',
  fade: '--fade',
  beat: '--beat',
  fontSans: '--font-sans',
  fontMono: '--font-mono',
};

/** Sous-ensemble du contexte 2D employé : un double de test suffit. */
export type PulseDrawingContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'fillText'
>;

export interface PulseScene {
  title: string;
  timeSec: number;
  analysis: ClipAnalysis;
}

/** Thème d'export à partir d'un lecteur de variables CSS ; valeur de secours si vide. */
export function readExportTheme(read: (name: string) => string): ExportTheme {
  const theme = { ...FALLBACK_THEME };
  for (const key of Object.keys(THEME_VARIABLES) as (keyof ExportTheme)[]) {
    const value = read(THEME_VARIABLES[key]).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

/** Titre tronqué avec une ellipse pour tenir sur une ligne de l'image. */
export function truncateTitle(title: string, max = TITLE_MAX_CHARS): string {
  const trimmed = title.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Nom de fichier sûr : sans accents, minuscules, tirets ; « extrait » par défaut. */
export function exportFileName(title: string, suffix: string, extension: 'png' | 'json'): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/g, '');
  return `${slug || 'extrait'}-${suffix}.${extension}`;
}

/** Analyse sérialisée telle qu'affichée (sensibilité comprise), indentée. */
export function analysisJson(analysis: ClipAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}

/** Abscisse (px) d'un instant dans la zone de tracé. */
export function exportX(time: number, durationSec: number, width = EXPORT_WIDTH): number {
  return PADDING + timeToRatio(time, durationSec) * (width - 2 * PADDING);
}

function verticalLine(ctx: PulseDrawingContext, x: number, top: number, bottom: number): void {
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
}

function drawHeader(ctx: PulseDrawingContext, scene: PulseScene, theme: ExportTheme, width: number): void {
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accent;
  ctx.font = `600 22px ${theme.fontMono}`;
  ctx.fillText('FILM PULSE · POULS DU MONTAGE', PADDING, LAYOUT.titleY);
  ctx.fillStyle = theme.text;
  ctx.font = `700 44px ${theme.fontSans}`;
  ctx.fillText(truncateTitle(scene.title), PADDING, LAYOUT.titleY + 36);
  ctx.textAlign = 'right';
  ctx.font = `600 30px ${theme.fontMono}`;
  ctx.fillText(
    `${formatTimecode(scene.timeSec, true)} / ${formatTimecode(scene.analysis.durationSec, true)}`,
    width - PADDING,
    LAYOUT.titleY + 44,
  );
}

function drawPalette(ctx: PulseDrawingContext, palette: readonly string[], width: number): void {
  const colors = palette.filter((color) => HEX_COLOR.test(color));
  if (colors.length === 0) return;
  const band = (width - 2 * PADDING) / colors.length;
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    // +1 px : évite les filets de fond entre deux couleurs voisines.
    ctx.fillRect(PADDING + i * band, LAYOUT.paletteTop, band + 1, LAYOUT.paletteHeight);
  });
}

function drawPulse(ctx: PulseDrawingContext, analysis: ClipAnalysis, theme: ExportTheme, width: number): void {
  const { durationSec } = analysis;
  ctx.fillStyle = theme.surface;
  ctx.fillRect(PADDING, LAYOUT.plotTop, width - 2 * PADDING, LAYOUT.plotBottom - LAYOUT.plotTop);

  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = theme.cut;
  for (const cut of analysis.cuts) verticalLine(ctx, exportX(cut, durationSec, width), LAYOUT.plotTop, LAYOUT.plotBottom);
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = theme.fade;
  for (const transition of analysis.transitions.filter((item) => item.kind === 'fade')) {
    verticalLine(ctx, exportX(transition.time, durationSec, width), LAYOUT.plotTop, LAYOUT.plotBottom);
  }
  ctx.globalAlpha = 1;

  const series = densitySeries(analysis.cuts, durationSec);
  const peak = Math.max(1, ...series);
  const height = LAYOUT.plotBottom - LAYOUT.plotTop - 16;
  const last = Math.max(1, series.length - 1);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  series.forEach((value, i) => {
    const x = PADDING + (i / last) * (width - 2 * PADDING);
    const y = LAYOUT.plotBottom - (value / peak) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawBeatsAndPlayhead(ctx: PulseDrawingContext, scene: PulseScene, theme: ExportTheme, width: number): void {
  const { durationSec } = scene.analysis;
  ctx.strokeStyle = theme.beat;
  ctx.lineWidth = 3;
  for (const beat of scene.analysis.beats) verticalLine(ctx, exportX(beat, durationSec, width), LAYOUT.beatTop, LAYOUT.beatBottom);

  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 2;
  verticalLine(ctx, exportX(scene.timeSec, durationSec, width), LAYOUT.paletteTop, LAYOUT.beatBottom);
}

function drawFooter(ctx: PulseDrawingContext, analysis: ClipAnalysis, theme: ExportTheme): void {
  const fades = analysis.transitions.filter((item) => item.kind === 'fade').length;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `500 24px ${theme.fontSans}`;
  const legend: [string, string][] = [
    [theme.accent, 'Pouls (densité de coupes)'],
    [theme.cut, `${analysis.cuts.length} coupes`],
    [theme.fade, `${fades} fondus`],
    [theme.beat, `${analysis.beats.length} beats`],
  ];
  let x = PADDING;
  for (const [color, label] of legend) {
    ctx.fillStyle = color;
    ctx.fillRect(x, LAYOUT.footerY + 4, 18, 18);
    ctx.fillStyle = theme.muted;
    ctx.fillText(label, x + 28, LAYOUT.footerY);
    x += 28 + label.length * 13 + 40;
  }
}

/** Dessine l'image du pouls : en-tête, palette, courbe, coupes, fondus, beats, tête de lecture et légende. */
export function drawPulseImage(
  ctx: PulseDrawingContext,
  scene: PulseScene,
  theme: ExportTheme,
  width = EXPORT_WIDTH,
  height = EXPORT_HEIGHT,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  drawHeader(ctx, scene, theme, width);
  drawPalette(ctx, scene.analysis.palette, width);
  drawPulse(ctx, scene.analysis, theme, width);
  drawBeatsAndPlayhead(ctx, scene, theme, width);
  drawFooter(ctx, scene.analysis, theme);
}
