import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { clamp, formatTimecode } from '../../pulse-timeline/chart-math';
import { nextCut, previousCut } from '../montage';

export const PLAYBACK_RATES: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
/** Le navigateur n'expose pas la cadence d'une vidéo : on avance d'une image à 25 i/s. */
export const FRAME_STEP_SEC = 1 / 25;
/** Recul de « J » : la lecture arrière n'est pas fiable avec `<video>`. */
export const REWIND_STEP_SEC = 5;
export const SECOND_STEP_SEC = 1;

export type PlayerAction =
  | 'toggle'
  | 'pause'
  | 'forward'
  | 'rewind'
  | 'frame-back'
  | 'frame-forward'
  | 'second-back'
  | 'second-forward';

/** Raccourci clavier du lecteur (J/K/L, espace, ←/→ image par image, Maj+←/→ seconde). */
export function shortcutAction(key: string, shiftKey: boolean): PlayerAction | null {
  switch (key) {
    case ' ':
      return 'toggle';
    case 'k':
    case 'K':
      return 'pause';
    case 'l':
    case 'L':
      return 'forward';
    case 'j':
    case 'J':
      return 'rewind';
    case 'ArrowLeft':
      return shiftKey ? 'second-back' : 'frame-back';
    case 'ArrowRight':
      return shiftKey ? 'second-forward' : 'frame-forward';
    default:
      return null;
  }
}

/** Vitesse immédiatement supérieure (« L » répété accélère), plafonnée à la dernière. */
export function fasterRate(rate: number): number {
  return PLAYBACK_RATES.find((candidate) => candidate > rate) ?? PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
}

export function formatRate(rate: number): string {
  return `${rate.toLocaleString('fr-FR')}×`;
}

const FORM_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/**
 * Lecteur à commandes personnalisées : la vidéo vient d'un ObjectURL fourni
 * par le parent. Le parent pilote les sauts par `seekTo()` et suit le temps
 * par `timeChange`.
 */
@Component({
  selector: 'app-video-player',
  templateUrl: './video-player.html',
  styleUrl: './video-player.css',
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
})
export class VideoPlayerComponent {
  readonly src = input.required<string>();
  readonly label = input('');
  readonly cuts = input<number[]>([]);
  /** Durée de l'analyse : les WebM enregistrés annoncent souvent `Infinity`. */
  readonly durationSec = input(0);
  readonly timeChange = output<number>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');

  readonly rates = PLAYBACK_RATES;
  readonly frameStep = FRAME_STEP_SEC;
  readonly formatRate = formatRate;
  readonly playing = signal(false);
  readonly currentTime = signal(0);
  readonly mediaDuration = signal(0);
  readonly rate = signal(1);
  readonly volume = signal(1);
  readonly muted = signal(false);
  readonly fullscreen = signal(false);

  readonly duration = computed(() => {
    const media = this.mediaDuration();
    return Number.isFinite(media) && media > 0 ? media : this.durationSec();
  });
  readonly timecode = computed(() => formatTimecode(this.currentTime(), true));
  readonly durationTimecode = computed(() => formatTimecode(this.duration(), true));
  readonly previousCutTime = computed(() => previousCut(this.cuts(), this.currentTime()));
  readonly nextCutTime = computed(() => nextCut(this.cuts(), this.currentTime()));
  readonly volumePercent = computed(() => Math.round((this.muted() ? 0 : this.volume()) * 100));

  togglePlay(): void {
    const video = this.video().nativeElement;
    if (video.paused) this.play();
    else video.pause();
  }

  seekTo(time: number): void {
    const end = this.duration();
    const target = end > 0 ? clamp(time, 0, end) : Math.max(0, time);
    this.video().nativeElement.currentTime = target;
    this.currentTime.set(target);
    this.timeChange.emit(target);
  }

  step(deltaSec: number): void {
    this.video().nativeElement.pause();
    this.seekTo(this.video().nativeElement.currentTime + deltaSec);
  }

  goToPreviousCut(): void {
    this.seekTo(this.previousCutTime() ?? 0);
  }

  goToNextCut(): void {
    const time = this.nextCutTime();
    if (time !== null) this.seekTo(time);
  }

  setRate(value: number | string): void {
    const rate = Number(value);
    if (!PLAYBACK_RATES.includes(rate)) return;
    this.video().nativeElement.playbackRate = rate;
    this.rate.set(rate);
  }

  setVolume(value: number | string): void {
    const volume = clamp(Number(value) / 100, 0, 1);
    const video = this.video().nativeElement;
    video.volume = volume;
    video.muted = volume === 0;
    this.volume.set(volume);
    this.muted.set(video.muted);
  }

  toggleMute(): void {
    const video = this.video().nativeElement;
    video.muted = !video.muted;
    this.muted.set(video.muted);
  }

  toggleFullscreen(): void {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : this.frame().nativeElement.requestFullscreen?.();
    request?.catch((error: unknown) => console.debug('[Montage] Plein écran refusé', error));
  }

  onFullscreenChange(): void {
    this.fullscreen.set(document.fullscreenElement === this.frame().nativeElement);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && FORM_TAGS.has(target.tagName)) return;
    const action = shortcutAction(event.key, event.shiftKey);
    // Espace sur un bouton : laisser le clic natif du bouton, sinon double action.
    if (!action || (action === 'toggle' && target?.tagName === 'BUTTON')) return;
    event.preventDefault();
    this.run(action);
  }

  onTimeUpdate(): void {
    const time = this.video().nativeElement.currentTime;
    this.currentTime.set(time);
    this.timeChange.emit(time);
  }

  onMetadata(): void {
    this.mediaDuration.set(this.video().nativeElement.duration);
  }

  onRateChange(): void {
    this.rate.set(this.video().nativeElement.playbackRate);
  }

  onVolumeChange(): void {
    const video = this.video().nativeElement;
    this.volume.set(video.volume);
    this.muted.set(video.muted);
  }

  private run(action: PlayerAction): void {
    const video = this.video().nativeElement;
    switch (action) {
      case 'toggle':
        return this.togglePlay();
      case 'pause':
        return video.pause();
      case 'forward':
        if (!video.paused) this.setRate(fasterRate(this.rate()));
        return this.play();
      case 'rewind':
        return this.seekTo(video.currentTime - REWIND_STEP_SEC);
      case 'frame-back':
        return this.step(-FRAME_STEP_SEC);
      case 'frame-forward':
        return this.step(FRAME_STEP_SEC);
      case 'second-back':
        return this.seekTo(video.currentTime - SECOND_STEP_SEC);
      case 'second-forward':
        return this.seekTo(video.currentTime + SECOND_STEP_SEC);
    }
  }

  private play(): void {
    this.video()
      .nativeElement.play()
      ?.catch((error: unknown) => console.debug('[Montage] Lecture refusée par le navigateur', error));
  }
}
