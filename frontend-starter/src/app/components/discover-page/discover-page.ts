import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { Observable, Subject, catchError, debounceTime, filter, map, of, switchMap, tap } from 'rxjs';
import { formatDecimal, formatSyncScore } from '../../shared/format/clip-format';
import { ClipSummary, DiscoverScope, DiscoverSort } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { ClipService, DiscoverOptions } from '../../shared/services/clip.service';
import { ClipCardComponent } from '../clip-card/clip-card';
import { createFrenchPaginatorIntl } from '../tracks-page/french-paginator-intl';

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MAX_LENGTH = 100;
export const DEFAULT_PAGE_SIZE = 12;
export const PAGE_SIZE_OPTIONS = [12, 24, 48];
export const RANKING_SIZE = 10;
const SKELETON_COUNT = 6;
const PODIUM_SIZE = 3;

export type DiscoverTab = DiscoverScope | 'rankings';
export type RankingId = Exclude<DiscoverSort, 'recent'>;

interface TabDefinition {
  id: DiscoverTab;
  label: string;
}

interface SortOption {
  value: DiscoverSort;
  label: string;
}

export interface RankingBoard {
  id: RankingId;
  title: string;
  description: string;
  metricLabel: string;
}

export interface RankingState {
  items: ClipSummary[];
  loading: boolean;
  error: string;
}

type LoadResult = { ok: true; page: Page<ClipSummary> } | { ok: false; error: unknown };

const EMPTY_RANKING: RankingState = { items: [], loading: false, error: '' };

/** « 1er », « 2e »… : le rang reste lisible sans les médailles décoratives. */
export function rankLabel(index: number): string {
  return index === 0 ? '1er' : `${index + 1}e`;
}

export function loadErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 0) {
    return 'Le serveur est injoignable. Vérifiez votre connexion puis réessayez.';
  }
  return 'Impossible de charger les extraits pour le moment.';
}

function discoverPaginatorIntl(): MatPaginatorIntl {
  const intl = createFrenchPaginatorIntl();
  intl.itemsPerPageLabel = 'Extraits par page :';
  return intl;
}

@Component({
  imports: [ReactiveFormsModule, MatPaginator, ClipCardComponent],
  templateUrl: './discover-page.html',
  styleUrl: './discover-page.css',
  providers: [{ provide: MatPaginatorIntl, useFactory: discoverPaginatorIntl }],
})
export class DiscoverPageComponent {
  private readonly clips = inject(ClipService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs: readonly TabDefinition[] = [
    { id: 'public', label: 'Public' },
    { id: 'friends', label: 'Amis' },
    { id: 'shared', label: 'Partagés avec moi' },
    { id: 'rankings', label: 'Classements' },
  ];
  readonly sortOptions: readonly SortOption[] = [
    { value: 'recent', label: 'Les plus récents' },
    { value: 'nervous', label: 'Les plus nerveux' },
    { value: 'synced', label: 'Les plus calés sur la musique' },
  ];
  readonly boards: readonly RankingBoard[] = [
    {
      id: 'nervous',
      title: 'Les plus nerveux',
      description: 'Plan moyen le plus court parmi les extraits publics.',
      metricLabel: 'Plan moyen',
    },
    {
      id: 'synced',
      title: 'Les plus calés sur la musique',
      description: 'Coupes qui tombent le plus souvent sur les temps forts.',
      metricLabel: 'Indice de synchro',
    },
  ];
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly searchMaxLength = SEARCH_MAX_LENGTH;
  readonly skeletons = Array.from({ length: SKELETON_COUNT }, (_, index) => index);
  readonly podiumSize = PODIUM_SIZE;
  readonly rankingSize = RANKING_SIZE;
  readonly rankLabel = rankLabel;

  readonly search = new FormControl('', { nonNullable: true });

  readonly tab = signal<DiscoverTab>('public');
  readonly sort = signal<DiscoverSort>('recent');
  readonly tag = signal('');
  readonly query = signal('');
  readonly page = signal(1);
  readonly limit = signal(DEFAULT_PAGE_SIZE);

  readonly items = signal<ClipSummary[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly announcement = signal('');

  readonly rankings = signal<Record<RankingId, RankingState>>({
    nervous: EMPTY_RANKING,
    synced: EMPTY_RANKING,
  });
  private rankingsLoaded = false;

  readonly isRankings = computed(() => this.tab() === 'rankings');
  readonly activeTabLabel = computed(
    () => this.tabs.find((tab) => tab.id === this.tab())?.label ?? '',
  );

  /** Étiquettes des résultats chargés ; l'étiquette active reste affichée même hors page. */
  readonly availableTags = computed(() => {
    const tags = new Set(this.items().flatMap((clip) => clip.tags));
    if (this.tag()) tags.add(this.tag());
    return [...tags].sort((a, b) => a.localeCompare(b, 'fr'));
  });

  readonly hasFilters = computed(() => this.query() !== '' || this.tag() !== '');

  private readonly requests = new Subject<DiscoverOptions>();

  constructor() {
    this.requests
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set('');
          this.announcement.set('Chargement des extraits…');
        }),
        switchMap((options) =>
          this.clips.discover(options).pipe(
            map((page): LoadResult => ({ ok: true, page })),
            catchError((error: unknown) => of<LoadResult>({ ok: false, error })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.applyResult(result));

    // Anti-rebond sur la frappe ; switchMap (plus haut) annule la requête en vol.
    this.search.valueChanges
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        map((value) => value.trim().slice(0, SEARCH_MAX_LENGTH)),
        filter((query) => query !== this.query()),
        takeUntilDestroyed(),
      )
      .subscribe((query) => {
        this.query.set(query);
        this.page.set(1);
        this.load();
      });

    this.load();
  }

  selectTab(tab: DiscoverTab): void {
    if (tab === this.tab()) return;
    this.tab.set(tab);
    if (tab === 'rankings') {
      if (!this.rankingsLoaded) this.loadRankings();
      return;
    }
    this.tag.set('');
    this.page.set(1);
    this.load();
  }

  /** Navigation clavier du motif « tablist » : flèches, Début, Fin (activation automatique). */
  onTabKeydown(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = this.tabs[next];
    this.selectTab(tab.id);
    this.host.nativeElement.querySelector<HTMLElement>(`#discover-tab-${tab.id}`)?.focus();
  }

  setSort(value: string): void {
    const option = this.sortOptions.find((candidate) => candidate.value === value);
    if (!option || option.value === this.sort()) return;
    this.sort.set(option.value);
    this.page.set(1);
    this.load();
  }

  toggleTag(tag: string): void {
    this.tag.set(this.tag() === tag ? '' : tag);
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.query.set('');
    this.tag.set('');
    this.page.set(1);
    this.load();
  }

  onPage(event: PageEvent): void {
    this.limit.set(event.pageSize);
    this.page.set(event.pageIndex + 1);
    this.load();
  }

  load(): void {
    const tab = this.tab();
    if (tab === 'rankings') return;
    const options: DiscoverOptions = {
      scope: tab,
      sort: this.sort(),
      page: this.page(),
      limit: this.limit(),
    };
    if (this.query()) options.q = this.query();
    if (this.tag()) options.tag = this.tag();
    console.debug('[Social] Découvrir : chargement', options);
    this.requests.next(options);
  }

  loadRankings(): void {
    this.rankingsLoaded = true;
    for (const board of this.boards) this.loadBoard(board.id);
  }

  open(clip: ClipSummary): void {
    void this.router.navigate(['/clips', clip.id]);
  }

  metric(board: RankingId, clip: ClipSummary): string {
    if (board === 'nervous') return `${formatDecimal(clip.avgShotLength, 1)} s`;
    return formatSyncScore(clip.syncScore);
  }

  emptyMessage(): string {
    if (this.hasFilters()) return 'Aucun extrait ne correspond à ces critères.';
    switch (this.tab()) {
      case 'friends':
        return 'Vos amis n’ont encore rendu aucun extrait visible.';
      case 'shared':
        return 'Personne ne vous a encore partagé d’extrait.';
      default:
        return 'Aucun extrait public pour le moment.';
    }
  }

  private loadBoard(id: RankingId): void {
    this.patchRanking(id, { loading: true, error: '' });
    this.fetchRanking(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.patchRanking(id, { items, loading: false });
          this.announcement.set(`Classement « ${this.boardTitle(id)} » chargé.`);
        },
        error: (error: unknown) =>
          this.patchRanking(id, { items: [], loading: false, error: loadErrorMessage(error) }),
      });
  }

  private fetchRanking(id: RankingId): Observable<ClipSummary[]> {
    return this.clips
      .discover({ scope: 'public', sort: id, page: 1, limit: RANKING_SIZE })
      .pipe(
        // Le serveur écarte déjà les extraits sans coupe ou sans score : pas de filtrage client.
        map((page) => page.items.slice(0, RANKING_SIZE)),
      );
  }

  private patchRanking(id: RankingId, changes: Partial<RankingState>): void {
    this.rankings.update((state) => ({ ...state, [id]: { ...state[id], ...changes } }));
  }

  private boardTitle(id: RankingId): string {
    return this.boards.find((board) => board.id === id)?.title ?? '';
  }

  private applyResult(result: LoadResult): void {
    this.loading.set(false);
    if (!result.ok) {
      console.error('[Social] Découvrir : échec du chargement', result.error);
      this.items.set([]);
      this.total.set(0);
      this.error.set(loadErrorMessage(result.error));
      this.announcement.set(this.error());
      return;
    }
    const { page } = result;
    this.items.set(page.items);
    this.total.set(page.total);
    this.announcement.set(
      page.total === 0
        ? 'Aucun extrait trouvé.'
        : `${page.total} extrait${page.total > 1 ? 's' : ''} trouvé${page.total > 1 ? 's' : ''}.`,
    );
  }
}
