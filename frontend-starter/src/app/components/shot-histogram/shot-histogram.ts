import { Component, computed, input } from '@angular/core';
import { ShotBin, histogramBins, round2, shotLengths } from '../pulse-timeline/chart-math';

const VIEW_WIDTH = 500;
const SLOT_WIDTH = VIEW_WIDTH / 5;
const BAR_INSET = 22;
const COMPARE_INSET = 12;
const CHART_TOP = 28;
const CHART_BOTTOM = 180;
const LABEL_Y = 202;
export const HISTOGRAM_VIEW_HEIGHT = 214;

interface BarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Part de chaque classe dans le total (0 si aucun plan). */
function shares(bins: readonly ShotBin[]): number[] {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  return bins.map((bin) => (total > 0 ? bin.count / total : 0));
}

function summarize(name: string, bins: readonly ShotBin[]): string {
  const parts = bins.map((bin) => `${bin.label} : ${bin.count} plan${bin.count > 1 ? 's' : ''}`);
  return `${name} : ${parts.join(', ')}`;
}

/**
 * Histogramme des durées de plan ; les hauteurs sont des parts du total
 * (pour comparer deux extraits de longueurs différentes), les valeurs affichées des effectifs.
 */
@Component({
  selector: 'app-shot-histogram',
  templateUrl: './shot-histogram.html',
  styleUrl: './shot-histogram.css',
})
export class ShotHistogramComponent {
  readonly cuts = input<number[]>([]);
  readonly durationSec = input(0);
  readonly compareCuts = input<number[] | null>(null);
  /** Durée de l'extrait comparé ; `null` = même durée que l'extrait principal. */
  readonly compareDurationSec = input<number | null>(null);
  readonly label = input('');
  readonly compareLabel = input('');

  readonly viewBox = `0 0 ${VIEW_WIDTH} ${HISTOGRAM_VIEW_HEIGHT}`;
  readonly chartBottom = CHART_BOTTOM;
  readonly viewWidth = VIEW_WIDTH;

  readonly bins = computed(() => histogramBins(shotLengths(this.cuts(), this.durationSec())));
  readonly compareBins = computed(() => {
    const cuts = this.compareCuts();
    if (cuts === null) return null;
    return histogramBins(shotLengths(cuts, this.compareDurationSec() ?? this.durationSec()));
  });

  private readonly maxShare = computed(() => {
    const compare = this.compareBins();
    return Math.max(...shares(this.bins()), ...(compare ? shares(compare) : []), 0);
  });

  readonly mainName = computed(() => this.label() || 'Durées de plan');
  readonly compareName = computed(() => this.compareLabel() || 'Comparaison');

  readonly bars = computed(() => {
    const compare = this.compareBins();
    const compareShares = compare ? shares(compare) : null;
    return shares(this.bins()).map((share, i) => {
      const slot = i * SLOT_WIDTH;
      const bin = this.bins()[i];
      const compareCount = compare ? compare[i].count : null;
      return {
        label: bin.label,
        main: this.geometry(slot + BAR_INSET, SLOT_WIDTH - 2 * BAR_INSET, share),
        compare:
          compareShares === null
            ? null
            : this.geometry(slot + COMPARE_INSET, SLOT_WIDTH - 2 * COMPARE_INSET, compareShares[i]),
        center: slot + SLOT_WIDTH / 2,
        value: compareCount === null ? `${bin.count}` : `${bin.count} / ${compareCount}`,
        valueY: CHART_TOP - 8,
      };
    });
  });

  readonly labelY = LABEL_Y;

  readonly summary = computed(() => {
    const compare = this.compareBins();
    const main = summarize(this.mainName(), this.bins());
    return compare ? `${main} ; ${summarize(this.compareName(), compare)}` : main;
  });

  private geometry(x: number, width: number, share: number): BarGeometry {
    const peak = this.maxShare();
    const height = peak > 0 ? round2((share / peak) * (CHART_BOTTOM - CHART_TOP)) : 0;
    return { x, y: round2(CHART_BOTTOM - height), width, height };
  }
}
