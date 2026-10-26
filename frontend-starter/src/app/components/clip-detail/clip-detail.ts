import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, Observable, catchError, map, switchMap, tap } from 'rxjs';
import { SYNC_ALIGNED_THRESHOLD } from '../../shared/analysis/sync-score';
import { Clip } from '../../shared/models/clip.model';
import { ClipService } from '../../shared/services/clip.service';
import { PulseTimelineComponent, formatPreciseTime, formatTime } from '../pulse-timeline/pulse-timeline';

/**
 * Marge de « Coupe précédente » : pendant la lecture, juste après une coupe,
 * un nouvel appui doit remonter à la coupe d'avant et non rester sur place.
 */
export const PREVIOUS_CUT_MARGIN_SEC = 0.5;
/** Tolérance de « Coupe suivante » : ignore la coupe sur laquelle on vient de sauter. */
const NEXT_CUT_EPSILON_SEC = 0.05;

export interface SyncInterpretation {
  value: string;
  verdict: string;
}

/** Libellé du score de synchro : ≈ 1 sans lien, > 1 calé, `null` non analysable. */
export function interpretSyncScore(score: number | null): SyncInterpretation {
  if (score === null || !Number.isFinite(score)) {
    return { value: '—', verdict: 'Bande-son non analysable' };
  }
  const value = `× ${formatDecimal(score, 2)}`;
  return score >= SYNC_ALIGNED_THRESHOLD
    ? { value, verdict: 'Calé sur la musique' }
    : { value, verdict: 'Sans lien avec la musique' };
}

/** Dernière coupe strictement avant `time - margin`, sinon `null`. */
export function previousCut(cuts: readonly number[], time: number, margin = PREVIOUS_CUT_MARGIN_SEC): number | null {
  let found: number | null = null;
  for (const cut of cuts) {
    if (cut < time - margin) found = cut;
    else break;
  }
  return found;
}

/** Première coupe après `time`, sinon `null`. */
export function nextCut(cuts: readonly number[], time: number): number | null {
  return cuts.find((cut) => cut > time + NEXT_CUT_EPSILON_SEC) ?? null;
}

function formatDecimal(value: number, digits: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Détail d'un extrait (`/clips/:id`) : lecteur vidéo, pouls du montage et statistiques. */
@Component({
  imports: [DatePipe, RouterLink, PulseTimelineComponent],
  templateUrl: './clip-detail.html',
  styleUrl: './clip-detail.css',
})
export class ClipDetailComponent {
  private readonly service = inject(ClipService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  readonly clip = signal<Clip | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly videoUrl = signal('');
  readonly videoLoading = signal(false);
  readonly videoError = signal('');
  readonly currentTime = signal(0);

  private readonly cuts = computed(() => this.clip()?.analysis.cuts ?? []);
  readonly previousCutTime = computed(() => previousCut(this.cuts(), this.currentTime()));
  readonly nextCutTime = computed(() => nextCut(this.cuts(), this.currentTime()));

  /** Numéro (1-based) du plan en cours : n coupes avant l'instant → plan n + 1. */
  readonly currentShot = computed(() => {
    const time = this.currentTime();
    return this.cuts().filter((cut) => cut <= time).length + 1;
  });

  readonly stats = computed(() => {
    const clip = this.clip();
    if (!clip) return [];
    const sync = interpretSyncScore(clip.syncScore);
    return [
      { label: 'Durée', value: formatTime(clip.durationSec), hint: `${formatDecimal(clip.durationSec, 1)} s` },
      { label: 'Coupes', value: String(clip.cutCount), hint: `${clip.cutCount + 1} plans` },
      { label: 'Plan moyen (ASL)', value: `${formatDecimal(clip.avgShotLength, 1)} s`, hint: 'Durée moyenne d’un plan' },
      { label: 'Beats', value: String(clip.analysis.beats.length), hint: 'Temps forts de la bande-son' },
      { label: 'Synchro coupes / musique', value: sync.value, hint: sync.verdict },
    ];
  });

  readonly currentTimeLabel = computed(() => formatPreciseTime(this.currentTime()));

  constructor() {
    this.destroyRef.onDestroy(() => this.revokeVideoUrl());

    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        tap(() => this.reset()),
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((blob) => {
        this.revokeVideoUrl();
        this.videoUrl.set(URL.createObjectURL(blob));
        this.videoLoading.set(false);
      });
  }

  onTimeUpdate(): void {
    const video = this.player()?.nativeElement;
    if (video) this.currentTime.set(video.currentTime);
  }

  seekTo(time: number): void {
    const video = this.player()?.nativeElement;
    if (video) video.currentTime = time;
    this.currentTime.set(time);
  }

  goToPreviousCut(): void {
    const time = this.previousCutTime();
    this.seekTo(time ?? 0);
  }

  goToNextCut(): void {
    const time = this.nextCutTime();
    if (time !== null) this.seekTo(time);
  }

  /** Réinitialise l'affichage avant de charger un nouvel extrait. */
  private reset(): void {
    this.revokeVideoUrl();
    this.clip.set(null);
    this.loading.set(true);
    this.error.set('');
    this.videoLoading.set(false);
    this.videoError.set('');
    this.currentTime.set(0);
  }

  /** Extrait puis octets vidéo ; n'émet que le `Blob`, les erreurs sont affichées. */
  private load(id: string): Observable<Blob> {
    if (!id) {
      this.loading.set(false);
      this.error.set('Extrait introuvable.');
      return EMPTY;
    }
    return this.service
      .get(id)
      .pipe(
        tap((clip) => {
          console.debug('[ClipDetail] Extrait chargé', clip.id);
          this.clip.set(clip);
          this.loading.set(false);
          this.videoLoading.set(true);
        }),
        catchError((error: unknown) => {
          console.error('[ClipDetail] Chargement impossible', error);
          this.loading.set(false);
          this.error.set(this.loadErrorMessage(error));
          return EMPTY;
        }),
        switchMap(() =>
          this.service.video(id).pipe(
            catchError((error: unknown) => {
              console.error('[ClipDetail] Vidéo indisponible', error);
              this.videoLoading.set(false);
              this.videoError.set(this.videoErrorMessage(error));
              return EMPTY;
            }),
          ),
        ),
      );
  }

  private revokeVideoUrl(): void {
    const url = this.videoUrl();
    if (!url) return;
    URL.revokeObjectURL(url);
    this.videoUrl.set('');
  }

  private loadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) return 'Extrait introuvable : il a été supprimé ou ne vous appartient pas.';
      if (error.status === 401) return 'Session expirée : reconnectez-vous pour consulter vos extraits.';
      if (error.status === 0) return 'Serveur injoignable, réessayez plus tard.';
    }
    return 'Impossible de charger cet extrait.';
  }

  private videoErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 404) {
      return 'Le fichier vidéo est introuvable ; l’analyse reste consultable.';
    }
    return 'La vidéo est indisponible ; l’analyse reste consultable.';
  }
}
