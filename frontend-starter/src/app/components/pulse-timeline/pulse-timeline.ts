import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { ClipAnalysis } from '../../shared/models/clip.model';

/** Fenêtre glissante de la densité de coupes (s), imposée par le cahier des charges. */
export const DENSITY_WINDOW_SEC = 5;
/** Nombre d'échantillons de la courbe : assez pour un tracé lisse, peu de nœuds SVG. */
export const PULSE_SAMPLES = 200;
/** Rayon (en échantillons) de la moyenne glissante qui lisse le pouls. */
export const SMOOTHING_RADIUS = 3;
/** Pas clavier : flèches = 1 s, Page précédente/suivante = 10 s. */
export const KEY_STEP_SEC = 1;
export const PAGE_STEP_SEC = 10;
/** Pas « ronds » candidats pour les graduations de l'axe (s). */
const TICK_STEPS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MAX_TICKS = 8;

/** Géométrie du `viewBox` (unités SVG, étirées horizontalement par `preserveAspectRatio="none"`). */
export const VIEW_WIDTH = 1000;
const PULSE_TOP = 8;
const PULSE_BOTTOM = 112;
const BEAT_TOP = 124;
const BEAT_BOTTOM = 148;
export const VIEW_HEIGHT = 156;

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

/** « m:ss » (secondes tronquées), pour l'axe et `aria-valuetext`. */
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

/** Points `[x, y]` du pouls dans la bande `[top, bottom]` ; `maxValue` = sommet de l'échelle. */
export function pulsePoints(
  values: readonly number[],
  maxValue: number,
  width = VIEW_WIDTH,
  top = PULSE_TOP,
  bottom = PULSE_BOTTOM,
): [number, number][] {
  if (values.length === 0) return [];
  const scale = maxValue > 0 ? maxValue : 1;
  const last = Math.max(1, values.length - 1);
  return values.map((value, i) => [
    round2((i / last) * width),
    round2(bottom - clamp(value / scale, 0, 1) * (bottom - top)),
  ]);
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * « Pouls » du montage : densité de coupes lissée, pic par coupe, bande des
 * beats et curseur de lecture. Se comporte comme un `slider` ARIA : clic et
 * clavier émettent `seek` (le parent reste maître de `currentTime`).
 */
@Component({
  selector: 'app-pulse-timeline',
  templateUrl: './pulse-timeline.html',
  styleUrl: './pulse-timeline.css',
})
export class PulseTimelineComponent {
  readonly analysis = input.required<ClipAnalysis>();
  readonly currentTime = input(0);
  readonly label = input('');
  /** Échelle horizontale commune (s), pour aligner plusieurs timelines ; `null` = durée de l'extrait. */
  readonly maxTime = input<number | null>(null);
  readonly seek = output<number>();

  private readonly plot = viewChild.required<ElementRef<HTMLElement>>('plot');

  readonly viewBox = `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;
  readonly pulseBottom = PULSE_BOTTOM;
  readonly beatTop = BEAT_TOP;
  readonly beatBottom = BEAT_BOTTOM;
  readonly viewWidth = VIEW_WIDTH;

  readonly hoveredCut = signal<number | null>(null);

  readonly duration = computed(() => Math.max(0, this.analysis().durationSec));
  readonly scaleDuration = computed(() => Math.max(this.duration(), this.maxTime() ?? 0));
  readonly accessibleName = computed(() => this.label() || 'Position de lecture');

  private readonly density = computed(() =>
    smooth(cutDensity(this.analysis().cuts, this.scaleDuration())),
  );

  readonly peakDensity = computed(() => Math.max(1, ...this.density()));
  readonly peakLabel = computed(() =>
    this.peakDensity().toLocaleString('fr-FR', { maximumFractionDigits: 1 }),
  );

  private readonly points = computed(() => pulsePoints(this.density(), this.peakDensity()));

  readonly linePath = computed(() =>
    this.points()
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`)
      .join(' '),
  );

  readonly areaPath = computed(() => {
    const line = this.linePath();
    return line ? `${line} L${VIEW_WIDTH} ${PULSE_BOTTOM} L0 ${PULSE_BOTTOM} Z` : '';
  });

  readonly cutMarks = computed(() =>
    this.analysis().cuts.map((time, index) => ({
      index,
      time,
      x: round2(timeToRatio(time, this.scaleDuration()) * VIEW_WIDTH),
    })),
  );

  /** Tous les beats en un seul `path` : des centaines de `<line>` alourdiraient le DOM. */
  readonly beatPath = computed(() =>
    this.analysis()
      .beats.map((beat) => {
        const x = round2(timeToRatio(beat, this.scaleDuration()) * VIEW_WIDTH);
        return `M${x} ${BEAT_TOP + 4}V${BEAT_BOTTOM - 4}`;
      })
      .join(''),
  );

  readonly ticks = computed(() =>
    axisTicks(this.scaleDuration()).map((time) => ({
      time,
      x: round2(timeToRatio(time, this.scaleDuration()) * VIEW_WIDTH),
      percent: timeToRatio(time, this.scaleDuration()) * 100,
      label: formatTime(time),
    })),
  );

  readonly clampedTime = computed(() => clamp(this.currentTime(), 0, this.duration()));
  readonly cursorPercent = computed(
    () => timeToRatio(this.clampedTime(), this.scaleDuration()) * 100,
  );
  readonly valueNow = computed(() => Math.round(this.clampedTime()));
  readonly valueText = computed(
    () => `${formatTime(this.clampedTime())} sur ${formatTime(this.duration())}`,
  );

  readonly hoveredLabel = computed(() => {
    const index = this.hoveredCut();
    if (index === null) return null;
    const time = this.analysis().cuts[index];
    if (time === undefined) return null;
    return {
      text: `Coupe ${index + 1} · ${formatPreciseTime(time)}`,
      percent: timeToRatio(time, this.scaleDuration()) * 100,
    };
  });

  onKeydown(event: KeyboardEvent): void {
    const target = this.keyTarget(event.key);
    if (target === null) return;
    event.preventDefault();
    this.seek.emit(target);
  }

  onPlotClick(event: MouseEvent): void {
    const rect = this.plot().nativeElement.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const time = ratioToTime((event.clientX - rect.left) / rect.width, this.scaleDuration());
    this.seek.emit(clamp(time, 0, this.duration()));
  }

  onCutClick(event: MouseEvent, time: number): void {
    event.stopPropagation();
    this.seek.emit(time);
  }

  private keyTarget(key: string): number | null {
    const now = this.clampedTime();
    const end = this.duration();
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
}
