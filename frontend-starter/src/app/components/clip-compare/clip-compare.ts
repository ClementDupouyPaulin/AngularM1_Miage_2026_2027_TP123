import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { Clip, ClipSummary } from '../../shared/models/clip.model';
import { ClipService } from '../../shared/services/clip.service';
import { interpretSyncScore } from '../clip-detail/clip-detail';
import { PulseTimelineComponent, formatTime } from '../pulse-timeline/pulse-timeline';

/** Nombre d'extraits proposés dans les listes déroulantes. */
export const COMPARE_LIST_LIMIT = 20;

export type Side = 'a' | 'b';

export const SIDES: readonly Side[] = ['a', 'b'];

export const SIDE_LABELS: Record<Side, string> = { a: 'Extrait A', b: 'Extrait B' };

export type SideState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clip: Clip };

export interface ClipComparison {
  /** Côté au plan moyen le plus court, `null` en cas d'égalité. */
  nervous: Side | null;
  /** Rapport ASL du plus lent sur ASL du plus nerveux (≥ 1). */
  nervousRatio: number;
  /** Côté au score de synchro le plus haut, `null` si égalité ou aucun score. */
  synced: Side | null;
}

export interface ComparisonRow {
  label: string;
  values: string[];
  /** Côté mis en évidence par `badge`, `null` si aucun. */
  winner: Side | null;
  badge: string;
  /** Pictogramme décoratif accompagnant `badge`. */
  icon: string;
}

function formatDecimal(value: number, digits: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function otherSide(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

/** Désigne le montage le plus nerveux (ASL le plus court) et le plus calé sur la musique. */
export function compareClips(a: Clip, b: Clip): ClipComparison {
  let nervous: Side | null = null;
  let nervousRatio = 1;
  if (a.avgShotLength > 0 && b.avgShotLength > 0 && a.avgShotLength !== b.avgShotLength) {
    nervous = a.avgShotLength < b.avgShotLength ? 'a' : 'b';
    nervousRatio = Math.max(a.avgShotLength, b.avgShotLength) / Math.min(a.avgShotLength, b.avgShotLength);
  }

  const scoreA = a.syncScore ?? -Infinity;
  const scoreB = b.syncScore ?? -Infinity;
  const synced: Side | null = scoreA === scoreB ? null : scoreA > scoreB ? 'a' : 'b';

  return { nervous, nervousRatio, synced };
}

/** Phrase de synthèse en français, ex. « A est 1,8× plus nerveux que B ». */
export function summarizeComparison(a: Clip, b: Clip): string {
  const clips: Record<Side, Clip> = { a, b };
  const { nervous, nervousRatio, synced } = compareClips(a, b);
  const name = (side: Side) => `${side.toUpperCase()} (« ${clips[side].title} »)`;

  const rhythm = nervous
    ? `${name(nervous)} est ${formatDecimal(nervousRatio, 1)}× plus nerveux que ${name(otherSide(nervous))}.`
    : 'Les deux extraits ont le même rythme de montage.';

  let sync: string;
  if (synced) {
    const score = (side: Side) => interpretSyncScore(clips[side].syncScore).value;
    sync = `${name(synced)} est le plus calé sur la musique (${score(synced)} contre ${score(otherSide(synced))}).`;
  } else if (a.syncScore === null) {
    sync = 'Aucune des deux bandes-son n’est analysable.';
  } else {
    sync = 'Les deux montages sont aussi calés l’un que l’autre sur la musique.';
  }
  return `${rhythm} ${sync}`;
}

/** Comparaison de deux extraits (`/clips/compare?a=<id>&b=<id>`) : pouls superposés et statistiques. */
@Component({
  imports: [RouterLink, PulseTimelineComponent],
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

  readonly clips = signal<ClipSummary[]>([]);
  readonly total = signal(0);
  readonly listLoading = signal(true);
  readonly listError = signal('');

  readonly selected = signal<Record<Side, string>>({ a: '', b: '' });
  readonly states = signal<Record<Side, SideState>>({ a: { status: 'idle' }, b: { status: 'idle' } });
  readonly currentTimes = signal<Record<Side, number>>({ a: 0, b: 0 });

  readonly isEmpty = computed(() => !this.listLoading() && !this.listError() && this.total() < 2);

  /** Liste + extraits chargés depuis l'URL mais absents de la première page. */
  readonly options = computed(() => {
    const list = this.clips();
    const extra = SIDES.map((side) => this.states()[side])
      .filter((state): state is Extract<SideState, { status: 'ready' }> => state.status === 'ready')
      .map((state) => state.clip)
      .filter((clip, i, all) => !list.some((item) => item.id === clip.id) && all.findIndex((c) => c.id === clip.id) === i);
    return [...list, ...extra];
  });

  readonly pair = computed(() => {
    const { a, b } = this.states();
    return a.status === 'ready' && b.status === 'ready' ? { a: a.clip, b: b.clip } : null;
  });

  /** Échelle de temps commune aux deux timelines. */
  readonly maxTime = computed(() => {
    const durations = SIDES.map((side) => {
      const state = this.states()[side];
      return state.status === 'ready' ? state.clip.analysis.durationSec : 0;
    });
    return Math.max(0, ...durations);
  });

  readonly comparison = computed(() => {
    const pair = this.pair();
    return pair ? compareClips(pair.a, pair.b) : null;
  });

  readonly summary = computed(() => {
    const pair = this.pair();
    return pair ? summarizeComparison(pair.a, pair.b) : '';
  });

  readonly rows = computed((): ComparisonRow[] => {
    const pair = this.pair();
    const comparison = this.comparison();
    if (!pair || !comparison) return [];
    const cells = (format: (clip: Clip) => string) => SIDES.map((side) => format(pair[side]));
    return [
      { label: 'Durée', values: cells((clip) => formatTime(clip.durationSec)), winner: null, badge: '', icon: '' },
      { label: 'Coupes', values: cells((clip) => String(clip.cutCount)), winner: null, badge: '', icon: '' },
      {
        label: 'Plan moyen (ASL)',
        values: cells((clip) => `${formatDecimal(clip.avgShotLength, 1)} s`),
        winner: comparison.nervous,
        badge: 'Plus nerveux',
        icon: '⚡',
      },
      { label: 'Beats', values: cells((clip) => String(clip.analysis.beats.length)), winner: null, badge: '', icon: '' },
      {
        label: 'Synchro coupes / musique',
        values: cells((clip) => {
          const sync = interpretSyncScore(clip.syncScore);
          return `${sync.value} · ${sync.verdict}`;
        }),
        winner: comparison.synced,
        badge: 'Plus calé sur la musique',
        icon: '♪',
      },
    ];
  });

  constructor() {
    this.loadList();
    for (const side of SIDES) this.watchSide(side);
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

  seekTo(side: Side, time: number): void {
    this.currentTimes.update((times) => ({ ...times, [side]: time }));
  }

  private loadList(): void {
    this.service
      .list(1, COMPARE_LIST_LIMIT)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.clips.set(page.items);
          this.total.set(page.total);
          this.listLoading.set(false);
        },
        error: (error: unknown) => {
          console.error('[ClipCompare] Liste indisponible', error);
          this.listLoading.set(false);
          this.listError.set(this.loadErrorMessage(error, 'Impossible de charger vos extraits.'));
        },
      });
  }

  /** Suit `?a=` / `?b=` : chaque changement annule la requête précédente du même côté. */
  private watchSide(side: Side): void {
    this.route.queryParamMap
      .pipe(
        map((params) => params.get(side) ?? ''),
        distinctUntilChanged(),
        switchMap((id) => {
          this.selected.update((selected) => ({ ...selected, [side]: id }));
          this.seekTo(side, 0);
          return id ? this.fetch(id) : of<SideState>({ status: 'idle' });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.states.update((states) => ({ ...states, [side]: state })));
  }

  private fetch(id: string): Observable<SideState> {
    return this.service.get(id).pipe(
      map((clip): SideState => ({ status: 'ready', clip })),
      startWith<SideState>({ status: 'loading' }),
      catchError((error: unknown) => {
        console.error('[ClipCompare] Chargement impossible', error);
        const message = this.loadErrorMessage(error, 'Impossible de charger cet extrait.');
        return of<SideState>({ status: 'error', message });
      }),
    );
  }

  private loadErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) return 'Extrait introuvable : il a été supprimé ou ne vous appartient pas.';
      if (error.status === 401) return 'Session expirée : reconnectez-vous pour consulter vos extraits.';
      if (error.status === 0) return 'Serveur injoignable, réessayez plus tard.';
    }
    return fallback;
  }
}
