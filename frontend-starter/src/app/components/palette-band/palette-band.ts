import { Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import {
  clamp,
  formatTime,
  keyboardSeekTarget,
  paletteStops,
  ratioToTime,
  timeToRatio,
} from '../pulse-timeline/chart-math';

let nextId = 0;

/** Bande des couleurs dominantes (une par seconde) ; clic et clavier émettent `seek`. */
@Component({
  selector: 'app-palette-band',
  templateUrl: './palette-band.html',
  styleUrl: './palette-band.css',
})
export class PaletteBandComponent {
  readonly palette = input<string[]>([]);
  readonly currentTime = input(0);
  readonly durationSec = input(0);
  readonly seek = output<number>();

  private readonly band = viewChild.required<ElementRef<HTMLElement>>('band');

  readonly gradientId = `palette-band-${nextId++}`;
  readonly stops = computed(() => paletteStops(this.palette()));
  readonly duration = computed(() => Math.max(0, this.durationSec()));
  readonly clampedTime = computed(() => clamp(this.currentTime(), 0, this.duration()));
  readonly cursorPercent = computed(() => timeToRatio(this.clampedTime(), this.duration()) * 100);
  readonly valueNow = computed(() => Math.round(this.clampedTime()));
  readonly valueText = computed(
    () => `${formatTime(this.clampedTime())} sur ${formatTime(this.duration())}`,
  );

  onClick(event: MouseEvent): void {
    const rect = this.band().nativeElement.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    this.seek.emit(ratioToTime((event.clientX - rect.left) / rect.width, this.duration()));
  }

  onKeydown(event: KeyboardEvent): void {
    const target = keyboardSeekTarget(event.key, this.clampedTime(), this.duration());
    if (target === null) return;
    event.preventDefault();
    this.seek.emit(target);
  }
}
