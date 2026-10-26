import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subject, catchError, distinctUntilChanged, forkJoin, map, of, startWith, switchMap } from 'rxjs';
import { Clip, ClipSummary } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { ClipService } from '../../shared/services/clip.service';
import { AccelerationChartComponent } from '../acceleration-chart/acceleration-chart';
import { PaletteBandComponent } from '../palette-band/palette-band';
import { PulseTimelineComponent, formatTimecode } from '../pulse-timeline/pulse-timeline';
import { ShotHistogramComponent } from '../shot-histogram/shot-histogram';
import {
  NERVOUS_BADGE,
  SIDES,
  SIDE_LABELS,
  SYNCED_BADGE,
  SideProfile,
  TONE_CHIPS,
  compareClips,
  comparisonRows,
  formatBpm,
  formatDecimal,
  otherSide,
  sideProfile,
  summarizeComparison,
} from './comparison';
import {
  SPEED_OPTIONS,
  Side,
  SyncMode,
  hasEndedAt,
  playbackRateFor,
  positionFromSideTime,
  referenceSide,
  followerResync,
  targetTime,
} from './transport';

export * from './comparison';
export * from './transport';

/** Taille de page de chaque liste (plafond imposé par l'API). */
export const COMPARE_LIST_LIMIT = 20;

export type SideState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clip: Clip };

export type MediaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; videoUrl: string; filmstripUrl: string };

export type ListGroupKey = 'mine' | 'public' | 'friends';

export interface OptionGroup {
  key: ListGroupKey;
  label: string;
  items: ClipSummary[];
}

export const GROUP_LABELS: Record<ListGroupKey, string> = { mine: 'Mes extraits', public: 'Publics', friends: 'Amis' };

const GROUP_KEYS: readonly ListGroupKey[] = ['mine', 'public', 'friends'];

export const MODE_LABELS: Record<SyncMode, string> = {
  absolute: 'Synchroniser (temps absolu)',
  relative: 'Aligner sur la durée relative',
};

const MODES: readonly SyncMode[] = ['absolute', 'relative'];

interface ListResult {
  key: ListGroupKey;
  items: ClipSummary[];
  failed: boolean;
  error?: unknown;
}

function groupOf(clip: ClipSummary): ListGroupKey {
  if (clip.isOwner) return 'mine';
  return clip.visibility === 'public' ? 'public' : 'friends';
}

/** Répartit les listes et les extraits chargés depuis l'URL en groupes, chaque extrait une seule fois. */
export function buildOptionGroups(lists: Record<ListGroupKey, ClipSummary[]>, extras: ClipSummary[]): OptionGroup[] {
  const seen = new Set<string>();
  const unseen = (clip: ClipSummary) => {
    if (seen.has(clip.id)) return false;
    seen.add(clip.id);
    return true;
  };
  return GROUP_KEYS.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    items: [...lists[key], ...extras.filter((clip) => groupOf(clip) === key)].filter(unseen),
  })).filter((group) => group.items.length > 0);
}

export function formatSpeed(speed: number): string {
  return `× ${speed.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
}

function perSide<T>(build: (side: Side) => T): Record<Side, T> {
  return { a: build('a'), b: build('b') };
}

/** Comparaison synchronisée de deux extraits (`/clips/compare?a=<id>&b=<id>`). */
@Component({
  imports: [RouterLink, PulseTimelineComponent, PaletteBandComponent, ShotHistogramComponent, AccelerationChartComponent],
  templateUrl: './clip-compare.html',
  styleUrl: './clip-compare.css',
})
export class ClipCompareComponent {
  private readonly service = inject(ClipService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly sides = SIDES;
  readonly sideLabels = SIDE_LABELS;
  readonly modes = MODES;
  readonly modeLabels = MODE_LABELS;
  readonly speeds = SPEED_OPTIONS;
  readonly nervousBadge = NERVOUS_BADGE;
  readonly syncedBadge = SYNCED_BADGE;
  readonly toneChips = TONE_CHIPS;
  readonly formatSpeed = formatSpeed;
  readonly formatBpm = formatBpm;
  readonly formatDecimal = formatDecimal;
  readonly formatTimecode = formatTimecode;

  readonly lists = signal<Record<ListGroupKey, ClipSummary[]>>({ mine: [], public: [], friends: [] });
  readonly listLoading = signal(true);
  readonly listError = signal('');
  readonly listWarning = signal('');

  readonly selected = signal<Record<Side, string>>({ a: '', b: '' });
  readonly states = signal<Record<Side, SideState>>({ a: { status: 'idle' }, b: { status: 'idle' } });
  readonly media = signal<Record<Side, MediaState>>({ a: { status: 'idle' }, b: { status: 'idle' } });

  /** Position commune (s) sur l'échelle de référence `maxTime`. */
  readonly position = signal(0);
  readonly playing = signal(false);
  readonly mode = signal<SyncMode>('absolute');
  readonly speed = signal(1);
  /** B muet par défaut : deux bandes-son simultanées sont inaudibles. */
  readonly muted = signal<Record<Side, boolean>>({ a: false, b: true });
  readonly playError = signal('');

  private readonly players = viewChildren<ElementRef<HTMLVideoElement>>('player');
  private readonly mediaRequests: Record<Side, Subject<Clip | null>> = { a: new Subject(), b: new Subject() };
  private frame: number | null = null;
  /** Instant (`performance.now()`) du dernier recalage du suiveur, `null` si aucun depuis le lancement. */
  private lastResyncMs: number | null = null;

  private readonly loadedClips = computed(() =>
    SIDES.map((side) => this.states()[side])
      .filter((state): state is Extract<SideState, { status: 'ready' }> => state.status === 'ready')
      .map((state) => state.clip),
  );

  readonly groups = computed(() => buildOptionGroups(this.lists(), this.loadedClips()));

  readonly isEmpty = computed(() => {
    if (this.listLoading() || this.listError()) return false;
    return this.groups().reduce((count, group) => count + group.items.length, 0) < 2;
  });

  readonly readyClips = computed(() =>
    perSide((side) => {
      const state = this.states()[side];
      return state.status === 'ready' ? state.clip : null;
    }),
  );

  readonly pair = computed(() => {
    const { a, b } = this.readyClips();
    return a && b ? { a, b } : null;
  });

  readonly durations = computed(() => perSide((side) => this.readyClips()[side]?.analysis.durationSec ?? 0));

  /** Échelle de temps commune : durée du plus long extrait. */
  readonly maxTime = computed(() => Math.max(0, this.durations().a, this.durations().b));

  readonly reference = computed(() => referenceSide(this.durations()));

  readonly sideTimes = computed(() =>
    perSide((side) => targetTime(this.position(), this.mode(), this.durations()[side], this.maxTime())),
  );

  readonly rates = computed(() =>
    perSide((side) => playbackRateFor(this.speed(), this.mode(), this.durations()[side], this.maxTime())),
  );

  readonly filmstripUrls = computed(() =>
    perSide((side) => {
      const state = this.media()[side];
      return state.status === 'ready' ? state.filmstripUrl : '';
    }),
  );

  readonly transportReady = computed(
    () => this.pair() !== null && SIDES.every((side) => this.media()[side].status === 'ready'),
  );

  readonly positionText = computed(() => `${formatTimecode(this.position())} / ${formatTimecode(this.maxTime())}`);
  readonly positionValueText = computed(
    () => `${formatTimecode(this.position())} sur ${formatTimecode(this.maxTime())}`,
  );

  readonly comparison = computed(() => {
    const pair = this.pair();
    return pair ? compareClips(pair.a, pair.b) : null;
  });

  readonly summary = computed(() => {
    const pair = this.pair();
    return pair ? summarizeComparison(pair.a, pair.b) : '';
  });

  readonly rows = computed(() => {
    const pair = this.pair();
    return pair ? comparisonRows(pair) : [];
  });

  readonly profiles = computed((): Record<Side, SideProfile> | null => {
    const pair = this.pair();
    return pair ? perSide((side) => sideProfile(pair[side])) : null;
  });

  constructor() {
    this.loadLists();
    for (const side of SIDES) {
      this.watchMedia(side);
      this.watchSide(side);
    }
    this.destroyRef.onDestroy(() => {
      this.stopLoop();
      for (const side of SIDES) this.revokeMedia(this.media()[side]);
    });
  }

  otherSide(side: Side): Side {
    return otherSide(side);
  }

  /** Largeur (%) d'une bande de palette sur l'échelle commune. */
  durationShare(side: Side): number {
    const max = this.maxTime();
    return max > 0 ? (this.durations()[side] / max) * 100 : 0;
  }

  onSelect(side: Side, event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [side]: id || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  togglePlay(): void {
    if (this.playing()) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.transportReady()) return;
    this.playError.set('');
    if (this.position() >= this.maxTime()) this.seek(0);
    this.playing.set(true);
    for (const side of SIDES) this.startSide(side);
    this.startLoop();
  }

  pause(): void {
    this.playing.set(false);
    this.stopLoop();
    for (const side of SIDES) this.player(side)?.pause();
  }

  seek(position: number): void {
    this.position.set(Math.min(this.maxTime(), Math.max(0, Number.isFinite(position) ? position : 0)));
    for (const side of SIDES) {
      const video = this.player(side);
      if (!video) continue;
      video.currentTime = this.sideTimes()[side];
      if (!this.playing()) continue;
      if (this.sideEnded(side)) video.pause();
      else if (video.paused) this.startSide(side);
    }
  }

  onScrub(event: Event): void {
    this.seek(Number((event.target as HTMLInputElement).value));
  }

  onSideSeek(side: Side, time: number): void {
    this.seek(positionFromSideTime(time, this.mode(), this.durations()[side], this.maxTime()));
  }

  setMode(mode: SyncMode): void {
    this.mode.set(mode);
    this.applyRates();
    this.seek(this.position());
  }

  onSpeed(event: Event): void {
    const speed = Number((event.target as HTMLSelectElement).value);
    if (!SPEED_OPTIONS.includes(speed)) return;
    this.speed.set(speed);
    this.applyRates();
  }

  toggleMute(side: Side): void {
    this.muted.update((muted) => ({ ...muted, [side]: !muted[side] }));
  }

  onLoadedMetadata(side: Side): void {
    const video = this.player(side);
    if (!video) return;
    video.playbackRate = this.rates()[side];
    video.currentTime = this.sideTimes()[side];
  }

  /** Seule la fin de la référence (le plus long) arrête le transport : l'autre finit de son côté. */
  onEnded(side: Side): void {
    if (side !== this.reference()) return;
    this.pause();
    this.position.set(this.maxTime());
  }

  private player(side: Side): HTMLVideoElement | null {
    return this.players().find((ref) => ref.nativeElement.dataset['side'] === side)?.nativeElement ?? null;
  }

  private sideEnded(side: Side): boolean {
    return hasEndedAt(this.position(), this.mode(), this.durations()[side], this.maxTime());
  }

  private startSide(side: Side): void {
    const video = this.player(side);
    if (!video || this.sideEnded(side)) return;
    video.playbackRate = this.rates()[side];
    Promise.resolve()
      .then(() => video.play())
      .catch((error: unknown) => this.onPlayFailed(error));
  }

  private onPlayFailed(error: unknown): void {
    // Une pause demandée pendant le démarrage interrompt `play()` : ce n'est pas une panne.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    console.error('[ClipCompare] Lecture impossible', error);
    this.pause();
    this.playError.set(
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Le navigateur a bloqué la lecture : cliquez de nouveau sur Lire.'
        : 'Lecture impossible de l’une des deux vidéos.',
    );
  }

  private applyRates(): void {
    for (const side of SIDES) {
      const video = this.player(side);
      if (video) video.playbackRate = this.rates()[side];
    }
  }

  private startLoop(): void {
    this.stopLoop();
    const step = () => {
      this.tick();
      this.frame = this.playing() ? requestAnimationFrame(step) : null;
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopLoop(): void {
    this.lastResyncMs = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** La référence donne l'horloge ; le suiveur est recalé si sa dérive dépasse la tolérance. */
  private tick(): void {
    const reference = this.reference();
    const master = this.player(reference);
    if (!master) return;
    this.position.set(
      positionFromSideTime(master.currentTime, this.mode(), this.durations()[reference], this.maxTime()),
    );
    const follower = otherSide(reference);
    const video = this.player(follower);
    if (!video) return;
    const now = performance.now();
    const fix = followerResync(
      { time: video.currentTime, playing: !video.paused && !video.ended, seeking: video.seeking },
      this.sideTimes()[follower],
      now,
      this.lastResyncMs,
    );
    if (fix === null) return;
    video.currentTime = fix;
    this.lastResyncMs = now;
  }

  private loadLists(): void {
    const settle = (key: ListGroupKey, source: Observable<Page<ClipSummary>>): Observable<ListResult> =>
      source.pipe(
        map((page): ListResult => ({ key, items: page.items, failed: false })),
        catchError((error: unknown) => of<ListResult>({ key, items: [], failed: true, error })),
      );

    forkJoin([
      settle('mine', this.service.list(1, COMPARE_LIST_LIMIT)),
      settle('public', this.service.discover({ scope: 'public', limit: COMPARE_LIST_LIMIT })),
      settle('friends', this.service.discover({ scope: 'friends', limit: COMPARE_LIST_LIMIT })),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        const lists = { mine: [], public: [], friends: [] } as Record<ListGroupKey, ClipSummary[]>;
        for (const result of results) lists[result.key] = result.items;
        this.lists.set(lists);

        const failed = results.filter((result) => result.failed);
        for (const result of failed) console.error(`[ClipCompare] Liste « ${GROUP_LABELS[result.key]} » indisponible`, result.error);
        if (failed.length === results.length) {
          this.listError.set(this.loadErrorMessage(failed[0].error, 'Impossible de charger les extraits.'));
        } else if (failed.length > 0) {
          this.listWarning.set(`Liste indisponible : ${failed.map((result) => GROUP_LABELS[result.key]).join(', ')}.`);
        }
        this.listLoading.set(false);
      });
  }

  /** Suit `?a=` / `?b=` : chaque changement annule la requête précédente du même côté. */
  private watchSide(side: Side): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get(side) ?? ''),
        distinctUntilChanged(),
        switchMap((id) => {
          this.pause();
          this.position.set(0);
          this.selected.update((selected) => ({ ...selected, [side]: id }));
          return id ? this.fetch(id) : of<SideState>({ status: 'idle' });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        this.states.update((states) => ({ ...states, [side]: state }));
        this.mediaRequests[side].next(state.status === 'ready' ? state.clip : null);
      });
  }

  /** Vidéo (obligatoire) et pellicule (facultative) du côté, annulées si l'extrait change. */
  private watchMedia(side: Side): void {
    this.mediaRequests[side]
      .pipe(
        distinctUntilChanged((previous, current) => previous?.id === current?.id),
        switchMap((clip) => (clip ? this.loadMedia(clip) : of<MediaState>({ status: 'idle' }))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        this.revokeMedia(this.media()[side]);
        this.media.update((media) => ({ ...media, [side]: state }));
      });
  }

  private fetch(id: string): Observable<SideState> {
    return this.service.get(id).pipe(
      map((clip): SideState => ({ status: 'ready', clip })),
      startWith<SideState>({ status: 'loading' }),
      catchError((error: unknown) => {
        console.error('[ClipCompare] Chargement impossible', error);
        return of<SideState>({ status: 'error', message: this.loadErrorMessage(error, 'Impossible de charger cet extrait.') });
      }),
    );
  }

  private loadMedia(clip: Clip): Observable<MediaState> {
    const filmstrip: Observable<Blob | null> = clip.hasFilmstrip
      ? this.service.filmstrip(clip.id).pipe(
          catchError((error: unknown) => {
            console.warn('[ClipCompare] Pellicule indisponible, vignettes désactivées', error);
            return of(null);
          }),
        )
      : of(null);

    return forkJoin({ video: this.service.video(clip.id), filmstrip }).pipe(
      map(
        ({ video, filmstrip: sprite }): MediaState => ({
          status: 'ready',
          videoUrl: URL.createObjectURL(video),
          filmstripUrl: sprite ? URL.createObjectURL(sprite) : '',
        }),
      ),
      startWith<MediaState>({ status: 'loading' }),
      catchError((error: unknown) => {
        console.error('[ClipCompare] Vidéo indisponible', error);
        return of<MediaState>({ status: 'error', message: this.loadErrorMessage(error, 'Vidéo indisponible.') });
      }),
    );
  }

  private revokeMedia(state: MediaState): void {
    if (state.status !== 'ready') return;
    URL.revokeObjectURL(state.videoUrl);
    if (state.filmstripUrl) URL.revokeObjectURL(state.filmstripUrl);
  }

  private loadErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) return 'Extrait introuvable : il a été supprimé ou ne vous est plus accessible.';
      if (error.status === 401) return 'Session expirée : reconnectez-vous pour consulter les extraits.';
      if (error.status === 0) return 'Serveur injoignable, réessayez plus tard.';
    }
    return fallback;
  }
}
