import { Component, ElementRef, afterRenderEffect, computed, input, output, viewChild } from '@angular/core';
import { ClipAnalysis } from '../../shared/models/clip.model';
import {
  activeThumbnailIndex,
  cssUrl,
  formatTimecode,
  spritePosition,
} from '../pulse-timeline/chart-math';

/**
 * Pellicule : une cellule bouton par vignette du sprite, la cellule du plan
 * en cours est mise en évidence et centrée dans la bande défilante.
 */
@Component({
  selector: 'app-filmstrip',
  templateUrl: './filmstrip.html',
  styleUrl: './filmstrip.css',
})
export class FilmstripComponent {
  /** ObjectURL du sprite JPEG ; vide = cellules sans image. */
  readonly url = input('');
  readonly analysis = input.required<ClipAnalysis>();
  readonly currentTime = input(0);
  readonly seek = output<number>();

  private readonly strip = viewChild.required<ElementRef<HTMLElement>>('strip');

  readonly image = computed(() => cssUrl(this.url()));
  readonly activeIndex = computed(() =>
    activeThumbnailIndex(this.analysis().thumbnailTimes ?? [], this.currentTime()),
  );

  readonly cells = computed(() =>
    (this.analysis().thumbnailTimes ?? []).map((time, index) => ({
      index,
      time,
      timecode: formatTimecode(time, true),
      position: spritePosition(index),
    })),
  );

  constructor() {
    afterRenderEffect(() => {
      this.cells();
      this.centerCell(this.activeIndex());
    });
  }

  /** Centre la cellule dans la bande sans faire défiler la page (contrairement à `scrollIntoView`). */
  private centerCell(index: number): void {
    if (index < 0) return;
    const container = this.strip().nativeElement;
    const cell = container.querySelectorAll<HTMLElement>('.cell')[index];
    if (!cell) return;
    container.scrollLeft = cell.offsetLeft - (container.clientWidth - cell.offsetWidth) / 2;
  }
}
