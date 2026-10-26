/** Niveaux de quantification par canal (8 niveaux = 512 cases). */
const LEVELS_PER_CHANNEL = 8;
const LEVEL_WIDTH = 256 / LEVELS_PER_CHANNEL;
const RGBA_STRIDE = 4;
/** Pixels dont aucun canal n'atteint ce niveau : quasi-noir pur (bandes, fondus au noir), ignorés. */
const NEAR_BLACK_MAX = 12;
const BLACK = '#000000';

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * Couleur dominante `#rrggbb` d'une image RGBA : couleur moyenne de la case
 * de quantification la plus peuplée, quasi-noir pur ignoré
 * (`#000000` si l'image n'a que du noir).
 */
export function dominantColor(rgba: Uint8ClampedArray): string {
  const binCount = LEVELS_PER_CHANNEL ** 3;
  const counts = new Uint32Array(binCount);
  const sums = new Float64Array(binCount * 3);
  for (let p = 0; p + RGBA_STRIDE <= rgba.length; p += RGBA_STRIDE) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    if (Math.max(r, g, b) < NEAR_BLACK_MAX) continue;
    const bin =
      (Math.floor(r / LEVEL_WIDTH) * LEVELS_PER_CHANNEL + Math.floor(g / LEVEL_WIDTH)) * LEVELS_PER_CHANNEL +
      Math.floor(b / LEVEL_WIDTH);
    counts[bin]++;
    sums[bin * 3] += r;
    sums[bin * 3 + 1] += g;
    sums[bin * 3 + 2] += b;
  }
  let best = -1;
  for (let bin = 0; bin < binCount; bin++) {
    if (counts[bin] > 0 && (best < 0 || counts[bin] > counts[best])) best = bin;
  }
  if (best < 0) return BLACK;
  const n = counts[best];
  return toHex(sums[best * 3] / n, sums[best * 3 + 1] / n, sums[best * 3 + 2] / n);
}

/** Une couleur par seconde : la plus fréquente parmi les images de cette seconde (la première en cas d'égalité). */
export function paletteFromColors(colorsPerFrame: string[], fps: number): string[] {
  if (!(fps > 0)) return [];
  const palette: string[] = [];
  const seconds = Math.ceil(colorsPerFrame.length / fps);
  for (let s = 0; s < seconds; s++) {
    const frames = colorsPerFrame.slice(Math.round(s * fps), Math.round((s + 1) * fps));
    if (frames.length === 0) continue;
    const counts = new Map<string, number>();
    for (const color of frames) counts.set(color, (counts.get(color) ?? 0) + 1);
    let best = frames[0];
    for (const [color, count] of counts) {
      if (count > (counts.get(best) ?? 0)) best = color;
    }
    palette.push(best);
  }
  return palette;
}
