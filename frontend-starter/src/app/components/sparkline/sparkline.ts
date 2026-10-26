import { Component, computed, input } from '@angular/core';
import { linePath, pulsePoints } from '../pulse-timeline/chart-math';

export type SparklineTone = 'calm' | 'steady' | 'brisk' | 'intense';

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 30;
const TOP = 2;
const BOTTOM = 28;

/** Mini-courbe des cartes ; décorative sans `label`, image décrite sinon. */
@Component({
  selector: 'app-sparkline',
  templateUrl: './sparkline.html',
  styleUrl: './sparkline.css',
  host: { '[attr.data-tone]': 'tone()' },
})
export class SparklineComponent {
  readonly values = input<number[]>([]);
  readonly tone = input<SparklineTone>('steady');
  readonly label = input('');

  readonly viewBox = `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;

  private readonly points = computed(() => {
    const values = this.values().filter((value) => Number.isFinite(value));
    const peak = Math.max(0, ...values);
    return pulsePoints(values, peak, VIEW_WIDTH, TOP, BOTTOM);
  });

  readonly line = computed(() => linePath(this.points()));
  readonly area = computed(() => {
    const line = this.line();
    return line ? `${line} L${VIEW_WIDTH} ${BOTTOM} L0 ${BOTTOM} Z` : '';
  });
}
