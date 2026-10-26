import { ClipAnalysis } from '../../shared/models/clip.model';
import {
  EXPORT_WIDTH,
  PulseDrawingContext,
  analysisJson,
  drawPulseImage,
  exportFileName,
  exportX,
  readExportTheme,
  truncateTitle,
} from './pulse-export';

const ANALYSIS: ClipAnalysis = {
  version: 2,
  durationSec: 20,
  fps: 10,
  cuts: [5, 10],
  beats: [1, 2, 3, 4],
  syncScore: 1.5,
  diffs: [0.1, 0.9],
  palette: ['#112233', 'pas-une-couleur', '#445566'],
  transitions: [
    { time: 5, kind: 'cut' },
    { time: 8, kind: 'fade' },
    { time: 10, kind: 'cut' },
  ],
  thumbnailTimes: [0, 5, 10],
  sensitivity: 3,
};

/** Double du contexte 2D : enregistre les appels et les styles au moment de chaque tracé. */
function recordingContext() {
  const calls: { op: string; args: unknown[]; fill: string; stroke: string }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  } as unknown as PulseDrawingContext;
  const record =
    (op: string) =>
    (...args: unknown[]) =>
      calls.push({ op, args, fill: String(ctx.fillStyle), stroke: String(ctx.strokeStyle) });
  Object.assign(ctx, {
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fillText: record('fillText'),
  });
  return { ctx, calls };
}

describe('pulse-export', () => {
  const theme = readExportTheme((name) => ({ '--bg': ' #ffffff ', '--rec': '#d0201f', '--beat': '#00739e' })[name] ?? '');

  it('lit les variables du thème avec repli', () => {
    expect(theme.background).toBe('#ffffff');
    expect(theme.cut).toBe('#d0201f');
    expect(theme.accent).toBe('#f5a524');
  });

  it('nomme les fichiers sans accents ni caractères spéciaux', () => {
    expect(exportFileName('Été à Paris !', 'pouls', 'png')).toBe('ete-a-paris-pouls.png');
    expect(exportFileName('***', 'analyse', 'json')).toBe('extrait-analyse.json');
  });

  it('sérialise l’analyse affichée', () => {
    expect(JSON.parse(analysisJson(ANALYSIS))).toEqual(ANALYSIS);
  });

  it('tronque les titres trop longs', () => {
    expect(truncateTitle('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(truncateTitle('  court  ')).toBe('court');
  });

  it('place les instants dans la zone de tracé', () => {
    expect(exportX(0, 20)).toBe(64);
    expect(exportX(20, 20)).toBe(EXPORT_WIDTH - 64);
  });

  it('dessine fond, titre, code temporel, palette, coupes, fondus et beats', () => {
    const { ctx, calls } = recordingContext();
    drawPulseImage(ctx, { title: 'Poursuite', timeSec: 12.4, analysis: ANALYSIS }, theme);

    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 1600, 900], fill: '#ffffff' });
    const texts = calls.filter((call) => call.op === 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('Poursuite');
    expect(texts).toContain('00:12,4 / 00:20,0');
    expect(texts).toContain('2 coupes');
    expect(texts).toContain('1 fondus');
    expect(texts).toContain('4 beats');

    const paletteFills = calls.filter((call) => call.op === 'fillRect' && call.args[1] === 170).map((call) => call.fill);
    expect(paletteFills).toEqual(['#112233', '#445566']);

    const strokes = calls.filter((call) => call.op === 'stroke').map((call) => call.stroke);
    expect(strokes.filter((color) => color === theme.cut)).toHaveLength(2);
    expect(strokes.filter((color) => color === theme.fade)).toHaveLength(1);
    expect(strokes.filter((color) => color === theme.beat)).toHaveLength(4);
    expect(strokes).toContain(theme.accent);
  });
});
