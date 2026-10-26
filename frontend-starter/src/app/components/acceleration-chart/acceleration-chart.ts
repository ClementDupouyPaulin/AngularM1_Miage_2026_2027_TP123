import { Component, computed, input } from '@angular/core';
import {
  ACCELERATION_WINDOW_SEC,
  SeriesPoint,
  accelerationSeries,
  axisTicks,
  formatNumber,
  formatTimecode,
  round2,
  timeToRatio,
} from '../pulse-timeline/chart-math';

const VIEW_WIDTH = 1000;
const CHART_TOP = 8;
const CHART_BOTTOM = 152;
const VIEW_HEIGHT = 160;

function describe(name: string, series: readonly SeriesPoint[]): string {
  if (series.length === 0) return `${name} : aucune donnée`;
  const peak = series.reduce((best, point) => (point.count > best.count ? point : best));
  const mean = series.reduce((sum, point) => sum + point.count, 0) / series.length;
  return `${name} : pic de ${peak.count} coupes à ${formatTimecode(peak.time)}, moyenne ${formatNumber(mean)}`;
}

/** Courbe d'accélération : coupes par fenêtre glissante de 10 s au fil du film, comparaison optionnelle. */
@Component({
  selector: 'app-acceleration-chart',
  templateUrl: './acceleration-chart.html',
  styleUrl: './acceleration-chart.css',
})
export class AccelerationChartComponent {
  readonly cuts = input<number[]>([]);
  readonly durationSec = input(0);
  readonly compareCuts = input<number[] | null>(null);
  /** Durée de l'extrait comparé ; `null` = même durée que l'extrait principal. */
  readonly compareDurationSec = input<number | null>(null);
  readonly label = input('');
  readonly compareLabel = input('');

  readonly viewBox = `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;
  readonly viewWidth = VIEW_WIDTH;
  readonly chartBottom = CHART_BOTTOM;
  readonly windowSec = ACCELERATION_WINDOW_SEC;

  readonly mainName = computed(() => this.label() || 'Accélération du montage');
  readonly compareName = computed(() => this.compareLabel() || 'Comparaison');

  private readonly compareDuration = computed(
    () => this.compareDurationSec() ?? this.durationSec(),
  );
  readonly series = computed(() => accelerationSeries(this.cuts(), this.durationSec()));
  readonly compareSeries = computed(() => {
    const cuts = this.compareCuts();
    return cuts === null ? null : accelerationSeries(cuts, this.compareDuration());
  });

  private readonly scaleDuration = computed(() =>
    Math.max(this.durationSec(), this.compareSeries() ? this.compareDuration() : 0),
  );

  readonly peak = computed(() =>
    Math.max(1, ...this.series().map((p) => p.count), ...(this.compareSeries() ?? []).map((p) => p.count)),
  );

  readonly mainPath = computed(() => this.path(this.series()));
  readonly mainArea = computed(() => {
    const line = this.mainPath();
    if (!line) return '';
    const endX = this.toX(this.series().at(-1)?.time ?? 0);
    return `${line} L${endX} ${CHART_BOTTOM} L0 ${CHART_BOTTOM} Z`;
  });
  readonly comparePath = computed(() => {
    const series = this.compareSeries();
    return series ? this.path(series) : '';
  });

  readonly ticks = computed(() =>
    axisTicks(this.scaleDuration()).map((time) => ({
      time,
      x: this.toX(time),
      percent: timeToRatio(time, this.scaleDuration()) * 100,
      label: formatTimecode(time),
    })),
  );

  readonly summary = computed(() => {
    const intro = `Coupes par fenêtre glissante de ${ACCELERATION_WINDOW_SEC} s au fil du film. `;
    const main = describe(this.mainName(), this.series());
    const compare = this.compareSeries();
    return compare ? `${intro}${main} ; ${describe(this.compareName(), compare)}` : intro + main;
  });

  private path(series: readonly SeriesPoint[]): string {
    const peak = this.peak();
    return series
      .map((point, i) => {
        const y = round2(CHART_BOTTOM - (point.count / peak) * (CHART_BOTTOM - CHART_TOP));
        return `${i === 0 ? 'M' : 'L'}${this.toX(point.time)} ${y}`;
      })
      .join(' ');
  }

  private toX(time: number): number {
    return round2(timeToRatio(time, this.scaleDuration()) * VIEW_WIDTH);
  }
}
