import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { ClipAnalysis, ClipAnnotation } from '../../shared/models/clip.model';
import {
  clamp,
  cssUrl,
  densitySeries,
  formatNumber,
  formatTime,
  formatTimecode,
  keyboardSeekTarget,
  linePath,
  nearestThumbnailIndex,
  paletteStops,
  pulsePoints,
  ratioToTime,
  round2,
  spritePosition,
  timeToRatio,
  axisTicks,
} from './chart-math';

export * from './chart-math';

/** Géométrie du `viewBox` (unités SVG, étirées horizontalement par `preserveAspectRatio="none"`). */
export const VIEW_WIDTH = 1000;
const PALETTE_TOP = 0;
const PALETTE_HEIGHT = 12;
const PULSE_TOP_WITH_PALETTE = 24;
const PULSE_TOP_ALONE = 8;
const PULSE_BOTTOM = 112;
const BEAT_TOP = 124;
const BEAT_BOTTOM = 148;
const HEIGHT_WITH_BEATS = 156;
const HEIGHT_WITHOUT_BEATS = 120;
/** Distance (px) en deçà de laquelle le survol ou le clic « s'aimante » sur une coupe. */
const CUT_SNAP_PX = 6;
const ANNOTATE_KEY = 'n';

let nextId = 0;

interface HoverState {
  time: number;
  cutIndex: number | null;
}

/**
 * « Pouls » du montage : densité de coupes lissée, coupes, fondus, beats,
 * palette, annotations et curseur de lecture. Se comporte comme un `slider`
 * ARIA : clic et clavier émettent `seek`, Maj+clic, double-clic ou « N »
 * émettent `annotateAt` (le parent reste maître de `currentTime`).
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
  readonly annotations = input<ClipAnnotation[]>([]);
  /** ObjectURL du sprite JPEG (cellules 160×90 alignées sur `analysis.thumbnailTimes`). */
  readonly filmstripUrl = input('');
  readonly showBeats = input(true);
  readonly showPalette = input(true);
  readonly seek = output<number>();
  readonly annotateAt = output<number>();

  private readonly plot = viewChild.required<ElementRef<HTMLElement>>('plot');

  readonly gradientId = `pulse-palette-${nextId++}`;
  readonly viewWidth = VIEW_WIDTH;
  readonly pulseBottom = PULSE_BOTTOM;
  readonly beatTop = BEAT_TOP;
  readonly beatBottom = BEAT_BOTTOM;
  readonly paletteTop = PALETTE_TOP;
  readonly paletteHeight = PALETTE_HEIGHT;

  readonly hover = signal<HoverState | null>(null);
  readonly focused = signal(false);

  readonly duration = computed(() => Math.max(0, this.analysis().durationSec));
  readonly scaleDuration = computed(() => Math.max(this.duration(), this.maxTime() ?? 0));
  readonly accessibleName = computed(() => this.label() || 'Position de lecture');
  readonly pulseTop = computed(() =>
    this.showPalette() ? PULSE_TOP_WITH_PALETTE : PULSE_TOP_ALONE,
  );
  readonly viewBox = computed(
    () => `0 0 ${VIEW_WIDTH} ${this.showBeats() ? HEIGHT_WITH_BEATS : HEIGHT_WITHOUT_BEATS}`,
  );

  private readonly density = computed(() =>
    densitySeries(this.analysis().cuts, this.scaleDuration()),
  );
  readonly peakDensity = computed(() => Math.max(1, ...this.density()));
  readonly peakLabel = computed(() => formatNumber(this.peakDensity()));

  private readonly points = computed(() =>
    pulsePoints(this.density(), this.peakDensity(), VIEW_WIDTH, this.pulseTop(), PULSE_BOTTOM),
  );
  readonly linePath = computed(() => linePath(this.points()));
  readonly areaPath = computed(() => {
    const line = this.linePath();
    return line ? `${line} L${VIEW_WIDTH} ${PULSE_BOTTOM} L0 ${PULSE_BOTTOM} Z` : '';
  });

  readonly cutMarks = computed(() =>
    this.analysis().cuts.map((time, index) => ({ index, time, x: this.toX(time) })),
  );

  readonly fadeMarks = computed(() =>
    (this.analysis().transitions ?? [])
      .filter((transition) => transition.kind === 'fade')
      .map((transition) => ({ time: transition.time, x: this.toX(transition.time) })),
  );

  /** Tous les beats en un seul `path` : des centaines de `<line>` alourdiraient le DOM. */
  readonly beatPath = computed(() =>
    this.analysis()
      .beats.map((beat) => `M${this.toX(beat)} ${BEAT_TOP + 4}V${BEAT_BOTTOM - 4}`)
      .join(''),
  );

  readonly paletteStops = computed(() => paletteStops(this.analysis().palette ?? []));
  readonly paletteWidth = computed(() => this.toX(this.duration()));

  readonly ticks = computed(() =>
    axisTicks(this.scaleDuration()).map((time) => ({
      time,
      x: this.toX(time),
      percent: timeToRatio(time, this.scaleDuration()) * 100,
      label: formatTimecode(time),
    })),
  );

  readonly pins = computed(() =>
    [...this.annotations()]
      .sort((a, b) => a.time - b.time)
      .map((annotation) => ({
        id: annotation.id,
        time: annotation.time,
        text: annotation.text,
        author: annotation.authorName,
        timecode: formatTimecode(annotation.time, true),
        percent: timeToRatio(annotation.time, this.scaleDuration()) * 100,
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

  readonly tooltip = computed(() => {
    const hover = this.hover() ?? (this.focused() ? { time: this.clampedTime(), cutIndex: null } : null);
    if (hover === null) return null;
    const times = this.analysis().thumbnailTimes ?? [];
    const url = this.filmstripUrl();
    const thumbIndex = url ? nearestThumbnailIndex(times, hover.time) : -1;
    return {
      title: hover.cutIndex === null ? 'Position' : `Coupe ${hover.cutIndex + 1}`,
      timecode: formatTimecode(hover.time, true),
      percent: timeToRatio(hover.time, this.scaleDuration()) * 100,
      thumb:
        thumbIndex < 0
          ? null
          : { image: cssUrl(url), position: spritePosition(thumbIndex) },
    };
  });

  onKeydown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === ANNOTATE_KEY && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.annotateAt.emit(this.clampedTime());
      return;
    }
    const target = keyboardSeekTarget(event.key, this.clampedTime(), this.duration());
    if (target === null) return;
    event.preventDefault();
    this.seek.emit(target);
  }

  onPlotClick(event: MouseEvent): void {
    const point = this.pointAt(event);
    if (point === null) return;
    if (event.shiftKey) this.annotateAt.emit(point.time);
    else this.seek.emit(point.time);
  }

  onPlotDblClick(event: MouseEvent): void {
    const point = this.pointAt(event);
    if (point !== null) this.annotateAt.emit(point.time);
  }

  onPlotMove(event: MouseEvent): void {
    this.hover.set(this.pointAt(event));
  }

  onPinClick(time: number): void {
    this.seek.emit(clamp(time, 0, this.duration()));
  }

  /** Instant visé par le pointeur, aimanté sur la coupe la plus proche à moins de `CUT_SNAP_PX`. */
  private pointAt(event: MouseEvent): HoverState | null {
    const rect = this.plot().nativeElement.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    const scale = this.scaleDuration();
    const time = clamp(ratioToTime((event.clientX - rect.left) / rect.width, scale), 0, this.duration());
    const tolerance = (CUT_SNAP_PX / rect.width) * scale;
    let cutIndex: number | null = null;
    let bestGap = tolerance;
    this.analysis().cuts.forEach((cut, index) => {
      const gap = Math.abs(cut - time);
      if (gap <= bestGap) {
        cutIndex = index;
        bestGap = gap;
      }
    });
    return cutIndex === null ? { time, cutIndex } : { time: this.analysis().cuts[cutIndex], cutIndex };
  }

  private toX(time: number): number {
    return round2(timeToRatio(time, this.scaleDuration()) * VIEW_WIDTH);
  }
}
