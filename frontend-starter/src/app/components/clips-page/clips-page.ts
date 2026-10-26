import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, debounceTime, filter, map, merge, switchMap } from 'rxjs';
import { DEFAULT_K, MAX_K, MIN_K } from '../../shared/analysis/cut-detector';
import { rhythmProfile } from '../../shared/analysis/rhythm';
import { estimateTempo } from '../../shared/analysis/tempo';
import {
  Clip,
  ClipAnalysis,
  ClipSummary,
  ClipVisibility,
  LibraryStats,
  TagCount,
} from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import {
  ClipAnalysisError,
  ClipAnalysisSample,
  ClipAnalyzerService,
  MAX_CLIP_DURATION_SEC,
  SAMPLE_FPS,
} from '../../shared/services/clip-analyzer.service';
import { ClipListFilters, ClipService } from '../../shared/services/clip.service';
import { ClipCardComponent } from '../clip-card/clip-card';
import { VISIBILITY_LABELS, formatDecimal, formatDuration, isSynced, syncScoreLabel } from '../clip-card/clip-format';
import { FilmstripComponent } from '../filmstrip/filmstrip';
import { formatTimecode } from '../pulse-timeline/chart-math';
import { PulseTimelineComponent } from '../pulse-timeline/pulse-timeline';
import {
  CONFIRM_DELETE_PANEL_CLASS,
  ConfirmDeleteDialogComponent,
  ConfirmDeleteDialogData,
} from '../tracks-page/confirm-delete-dialog/confirm-delete-dialog';
import { fileExtension } from '../tracks-page/file-extension';
import { createFrenchPaginatorIntl } from '../tracks-page/french-paginator-intl';

/** Taille maximale acceptée, alignée sur la limite Multer de `/api/clips`. */
export const MAX_CLIP_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES: readonly string[] = ['video/mp4', 'video/webm'];
/** Repli quand le navigateur renvoie un `File.type` vide. */
const ALLOWED_EXTENSIONS: readonly string[] = ['.mp4', '.webm'];

export const TITLE_MAX_LENGTH = 120;
export const MAX_TAGS = 5;
export const TAG_MAX_LENGTH = 24;
/** Délai d'anti-rebond du filtre : une requête par pause de frappe. */
export const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 100;
const PAGE_SIZE_OPTIONS: readonly number[] = [6, 12, 24];
const DEFAULT_PAGE_SIZE = 12;
const SENSITIVITY_STEP = 0.5;
export const COMPARE_SIZE = 2;

/** Aperçu en direct : viewBox 100 × 40, domaine minimal de 10 s pour que la courbe se remplisse avant de se resserrer. */
const LIVE_WIDTH = 100;
const LIVE_HEIGHT = 40;
const LIVE_MIN_FRAMES = 10 * SAMPLE_FPS;
const LIVE_DECIMALS = 100;
const FRAME_FALLBACK_MS = 16;

const BYTES_PER_KB = 1024;
const PERCENT = 100;
const SNACKBAR_SUCCESS_MS = 6000;
const SNACKBAR_ERROR_MS = 6000;

export interface LiveSwatch {
  x: number;
  width: number;
  color: string;
}

export { formatDuration, syncScoreLabel };

function roundLive(value: number): number {
  return Math.round(value * LIVE_DECIMALS) / LIVE_DECIMALS;
}

/** Nombre d'images couvert par la largeur de l'aperçu en direct. */
export function liveDomain(sampleCount: number): number {
  return Math.max(sampleCount, LIVE_MIN_FRAMES);
}

/** Tracé SVG des différences image par image (0-1) dans la viewBox de l'aperçu. */
export function liveDiffPath(diffs: readonly number[], domain = liveDomain(diffs.length)): string {
  return diffs
    .map((diff, i) => {
      const x = roundLive((i / domain) * LIVE_WIDTH);
      const y = roundLive(LIVE_HEIGHT - Math.min(1, Math.max(0, diff)) * LIVE_HEIGHT);
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join('');
}

/** Une pastille de couleur par seconde échantillonnée (première image de chaque seconde). */
export function liveSwatches(colors: readonly string[], domain = liveDomain(colors.length)): LiveSwatch[] {
  const width = roundLive((SAMPLE_FPS / domain) * LIVE_WIDTH);
  const swatches: LiveSwatch[] = [];
  for (let i = 0; i < colors.length; i += SAMPLE_FPS) {
    swatches.push({ x: roundLive((i / domain) * LIVE_WIDTH), width, color: colors[i] });
  }
  return swatches;
}

/** Étiquette normalisée (sans `#`, rognée, en minuscules). */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

/** Message d'erreur si l'étiquette ne peut pas rejoindre `current`, sinon `undefined`. */
export function tagError(tag: string, current: readonly string[]): string | undefined {
  if (tag.length > TAG_MAX_LENGTH) return `Une étiquette fait ${TAG_MAX_LENGTH} caractères maximum.`;
  if (current.length >= MAX_TAGS) return `${MAX_TAGS} étiquettes maximum.`;
  return undefined;
}

/** Page « Studio » : tableau de bord, import avec aperçu d'analyse en direct, bibliothèque en cartes. */
@Component({
  imports: [ReactiveFormsModule, MatPaginator, RouterLink, ClipCardComponent, PulseTimelineComponent, FilmstripComponent],
  templateUrl: './clips-page.html',
  styleUrl: './clips-page.css',
  providers: [{ provide: MatPaginatorIntl, useFactory: createClipsPaginatorIntl }],
})
export class ClipsPageComponent {
  private readonly service = inject(ClipService);
  private readonly analyzer = inject(ClipAnalyzerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly resultHeading = viewChild<ElementRef<HTMLElement>>('resultHeading');

  readonly titleMaxLength = TITLE_MAX_LENGTH;
  readonly tagMaxLength = TAG_MAX_LENGTH;
  readonly maxTags = MAX_TAGS;
  readonly searchMaxLength = SEARCH_MAX_LENGTH;
  readonly maxDurationSec = MAX_CLIP_DURATION_SEC;
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly minK = MIN_K;
  readonly maxK = MAX_K;
  readonly sensitivityStep = SENSITIVITY_STEP;
  readonly liveViewBox = `0 0 ${LIVE_WIDTH} ${LIVE_HEIGHT}`;
  readonly visibilityLabels = VISIBILITY_LABELS;
  readonly maxFileSizeLabel = formatSize(MAX_CLIP_FILE_SIZE);
  readonly acceptAttribute = [...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS].join(',');
  readonly formatDuration = formatDuration;
  readonly formatTimecode = formatTimecode;
  readonly formatDecimal = formatDecimal;

  /** Message ponctuel (sélection, étiquettes) lu par les lecteurs d'écran. */
  readonly announcement = signal('');

  // --- Tableau de bord --------------------------------------------------------
  readonly stats = signal<LibraryStats | null>(null);
  readonly statsError = signal('');

  // --- Bibliothèque -------------------------------------------------------------
  readonly clips = signal<ClipSummary[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly total = signal(0);
  readonly limit = signal(DEFAULT_PAGE_SIZE);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly tagCounts = signal<TagCount[]>([]);
  readonly tagFilter = signal('');
  readonly visibilityFilter = signal<ClipVisibility | ''>('');
  readonly query = signal('');
  readonly skeletons = computed(() => Array.from({ length: Math.min(this.limit(), PAGE_SIZE_OPTIONS[0]) }, (_, i) => i));

  readonly search = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(SEARCH_MAX_LENGTH)] });
  readonly searchText = toSignal(this.search.valueChanges, { initialValue: this.search.value });
  private readonly searchNow = new Subject<void>();
  private readonly reload = new Subject<void>();

  readonly filtered = computed(() => !!(this.query() || this.tagFilter() || this.visibilityFilter()));

  readonly resultsAnnouncement = computed(() => {
    if (this.loading() || this.error()) return '';
    const total = this.total();
    if (this.filtered()) {
      return total === 0 ? 'Aucun extrait ne correspond aux filtres.' : `${total} extrait${total > 1 ? 's' : ''} trouvé${total > 1 ? 's' : ''}.`;
    }
    return total === 1 ? '1 extrait dans le Studio.' : `${total} extraits dans le Studio.`;
  });

  // --- Comparaison ----------------------------------------------------------------
  readonly selection = signal<ClipSummary[]>([]);
  readonly selectedIds = computed(() => new Set(this.selection().map((clip) => clip.id)));
  readonly compareQuery = computed(() => {
    const [a, b] = this.selection();
    return a && b ? { a: a.id, b: b.id } : null;
  });

  // --- Fichier ------------------------------------------------------------------------
  readonly file = signal<File | undefined>(undefined);
  readonly fileError = signal('');
  readonly dragging = signal(false);

  // --- Analyse ------------------------------------------------------------------------
  readonly analyzing = signal(false);
  readonly analysisProgress = signal(0);
  readonly analysisError = signal('');
  readonly analysisNotice = signal('');
  /** Analyse brute (k par défaut) ; `analysis` en dérive par le curseur de sensibilité. */
  private readonly baseAnalysis = signal<ClipAnalysis | null>(null);
  readonly analysis = signal<ClipAnalysis | null>(null);
  readonly sensitivity = signal(DEFAULT_K);
  readonly filmstripUrl = signal('');
  private filmstrip: Blob | null = null;
  private abortController: AbortController | undefined;

  readonly liveSamples = signal<ClipAnalysisSample[]>([]);
  private liveBuffer: ClipAnalysisSample[] = [];
  private liveFrame: ReturnType<typeof setTimeout> | number | undefined;
  readonly livePath = computed(() => liveDiffPath(this.liveSamples().map((sample) => sample.diff)));
  readonly liveColors = computed(() => liveSwatches(this.liveSamples().map((sample) => sample.color)));
  readonly liveTime = computed(() => formatTimecode(this.liveSamples().at(-1)?.time ?? 0, true));

  readonly rhythm = computed(() => {
    const analysis = this.analysis();
    return analysis ? rhythmProfile(analysis.cuts, analysis.durationSec) : null;
  });
  readonly tempo = computed(() => {
    const analysis = this.analysis();
    return analysis ? estimateTempo(analysis.beats) : null;
  });
  /** Temps musicaux entre deux coupes (BPM ÷ coupes/min) ; `null` si l'un manque. */
  readonly beatsPerCut = computed(() => {
    const tempo = this.tempo();
    const cutsPerMinute = this.rhythm()?.cutsPerMinute ?? 0;
    return tempo && cutsPerMinute > 0 ? tempo / cutsPerMinute : null;
  });
  readonly synced = computed(() => isSynced(this.analysis()?.syncScore ?? null));
  readonly syncLabel = computed(() => syncScoreLabel(this.analysis()?.syncScore ?? null));
  /** Position du curseur : plus à droite = plus sensible = k plus petit. */
  readonly sensitivityLevel = computed(() => MIN_K + MAX_K - this.sensitivity());

  // --- Métadonnées et envoi --------------------------------------------------------------
  readonly title = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(TITLE_MAX_LENGTH)] });
  private readonly titleStatus = toSignal(this.title.statusChanges, { initialValue: this.title.status });
  readonly tagDraft = new FormControl('', { nonNullable: true });
  readonly tags = signal<string[]>([]);
  readonly tagMessage = signal('');
  readonly visibility = new FormControl<ClipVisibility>('private', { nonNullable: true });

  readonly uploading = signal(false);
  /** `null` tant que le total d'octets est inconnu (barre indéterminée). */
  readonly uploadProgress = signal<number | null>(null);
  readonly uploadError = signal('');
  readonly lastCreated = signal<Clip | null>(null);

  readonly busy = computed(() => this.analyzing() || this.uploading());
  readonly canAnalyze = computed(
    () => !this.busy() && this.file() !== undefined && !this.fileError() && this.analysis() === null,
  );
  readonly canUpload = computed(() => !this.busy() && this.analysis() !== null && this.titleStatus() !== 'INVALID');

  // --- Suppression ----------------------------------------------------------------------
  readonly deletingId = signal('');
  private confirmingDelete = false;

  constructor() {
    merge(this.search.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS)), this.searchNow)
      .pipe(
        map(() => this.search.value.trim()),
        filter((query) => query !== this.query() && query.length <= SEARCH_MAX_LENGTH),
        takeUntilDestroyed(),
      )
      .subscribe((query) => {
        this.query.set(query);
        this.page.set(1);
        this.load();
      });

    this.reload
      .pipe(
        switchMap(() => {
          const sequence = this.beginLoad();
          return this.service.list(this.page(), this.limit(), this.filters()).pipe(
            map((response) => ({ sequence, response })),
            catchError((error: unknown) => {
              this.applyLoadError(sequence, error);
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ sequence, response }) => this.applyPage(sequence, response));

    this.destroyRef.onDestroy(() => {
      this.abortController?.abort();
      this.cancelLiveFrame();
      this.revokeFilmstrip();
    });

    this.load();
    this.loadStats();
    this.loadTags();
  }

  // --- Tableau de bord et étiquettes ----------------------------------------------------

  loadStats(): void {
    this.statsError.set('');
    this.service
      .stats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => this.stats.set(stats),
        error: (error: unknown) => this.statsError.set(serverMessage(error, 'Statistiques indisponibles.')),
      });
  }

  loadTags(): void {
    this.service
      .tags()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tags) => this.tagCounts.set(tags),
        error: () => console.debug('[Studio] Étiquettes indisponibles'),
      });
  }

  private refreshLibrary(): void {
    this.load();
    this.loadStats();
    this.loadTags();
  }

  // --- Bibliothèque ------------------------------------------------------------------------

  private filters(): ClipListFilters {
    return { q: this.query(), tag: this.tagFilter() || undefined, visibility: this.visibilityFilter() || undefined };
  }

  /** Seule la réponse du dernier chargement lancé écrit dans les signaux. */
  private loadSequence = 0;

  load(): void {
    this.reload.next();
  }

  private beginLoad(): number {
    this.loading.set(true);
    this.error.set('');
    return ++this.loadSequence;
  }

  private applyPage(sequence: number, response: Page<ClipSummary>): void {
    if (sequence !== this.loadSequence) return;
    this.clips.set(response.items);
    this.pages.set(response.pages);
    this.total.set(response.total);
    this.page.set(response.page);
    this.loading.set(false);
  }

  private applyLoadError(sequence: number, error: unknown): void {
    if (sequence !== this.loadSequence) return;
    this.error.set(serverMessage(error, 'Impossible de charger vos extraits.'));
    this.clips.set([]);
    this.loading.set(false);
  }

  onPage(event: PageEvent): void {
    if (event.pageSize !== this.limit()) {
      this.limit.set(event.pageSize);
      this.page.set(1);
    } else {
      this.page.set(event.pageIndex + 1);
    }
    this.load();
  }

  toggleTagFilter(tag: string): void {
    this.tagFilter.update((current) => (current === tag ? '' : tag));
    this.page.set(1);
    this.load();
  }

  setVisibilityFilter(value: string): void {
    this.visibilityFilter.set(value === 'private' || value === 'shared' || value === 'public' ? value : '');
    this.page.set(1);
    this.load();
  }

  clearSearch(): void {
    this.search.setValue('');
    this.searchNow.next();
    this.searchInput()?.nativeElement.focus();
  }

  resetFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.query.set('');
    this.tagFilter.set('');
    this.visibilityFilter.set('');
    this.page.set(1);
    this.load();
  }

  openClip(clip: ClipSummary): void {
    void this.router.navigate(['/clips', clip.id]);
  }

  // --- Comparaison -------------------------------------------------------------------------

  /** Ajoute ou retire un extrait ; au-delà de deux, le plus ancien choix cède sa place. */
  toggleSelect(clip: ClipSummary): void {
    const current = this.selection();
    if (current.some((item) => item.id === clip.id)) {
      this.selection.set(current.filter((item) => item.id !== clip.id));
      this.announcement.set(`« ${clip.title} » retiré de la comparaison.`);
      return;
    }
    const next = [...current, clip].slice(-COMPARE_SIZE);
    this.selection.set(next);
    const dropped = current.find((item) => !next.includes(item));
    this.announcement.set(
      dropped
        ? `« ${clip.title} » remplace « ${dropped.title} » dans la comparaison.`
        : `« ${clip.title} » sélectionné pour la comparaison (${next.length} sur ${COMPARE_SIZE}).`,
    );
  }

  clearSelection(): void {
    this.selection.set([]);
    this.announcement.set('Sélection de comparaison vidée.');
  }

  // --- Fichier ------------------------------------------------------------------------------

  choose(event: Event): void {
    this.selectFile((event.target as HTMLInputElement).files?.[0]);
  }

  onDragOver(event: DragEvent): void {
    if (this.busy()) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.busy()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.selectFile(file);
  }

  /** Nouveau fichier : l'analyse démarre aussitôt s'il est valide. */
  selectFile(file: File | undefined): void {
    if (this.busy()) return;
    this.clearAnalysis();
    this.file.set(file);
    this.fileError.set(file ? (validateClipFile(file) ?? '') : '');
    this.uploadError.set('');
    this.lastCreated.set(null);
    if (file && !this.fileError()) void this.analyze();
  }

  // --- Analyse ------------------------------------------------------------------------------

  async analyze(): Promise<void> {
    const file = this.file();
    if (!file || this.busy()) return;
    const invalid = validateClipFile(file);
    if (invalid) {
      this.fileError.set(invalid);
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;
    this.clearAnalysis();
    this.analyzing.set(true);
    console.debug('[Studio] Analyse lancée', file.name);

    try {
      const result = await this.analyzer.analyze(file, {
        signal: controller.signal,
        onProgress: (ratio) => this.analysisProgress.set(Math.round(Math.min(1, Math.max(0, ratio)) * PERCENT)),
        onSample: (sample) => this.pushSample(sample),
      });
      this.flushLive();
      this.baseAnalysis.set(result.analysis);
      this.sensitivity.set(result.analysis.sensitivity);
      this.analysis.set(result.analysis);
      this.filmstrip = result.filmstrip;
      if (result.filmstrip) this.filmstripUrl.set(URL.createObjectURL(result.filmstrip));
      this.analysisNotice.set(`Analyse terminée : ${result.analysis.cuts.length} coupes détectées.`);
      queueMicrotask(() => this.resultHeading()?.nativeElement.focus());
    } catch (error: unknown) {
      this.applyAnalysisError(error);
    } finally {
      this.cancelLiveFrame();
      this.analyzing.set(false);
      if (this.abortController === controller) this.abortController = undefined;
    }
  }

  cancelAnalysis(): void {
    this.abortController?.abort();
  }

  private applyAnalysisError(error: unknown): void {
    this.liveBuffer = [];
    this.liveSamples.set([]);
    this.analysisProgress.set(0);
    if (error instanceof ClipAnalysisError) {
      if (error.code === 'aborted') this.analysisNotice.set(error.message);
      else this.analysisError.set(error.message);
      return;
    }
    console.error('[Studio] Analyse impossible', error);
    this.analysisError.set('Analyse impossible, réessayez avec une autre vidéo.');
  }

  /** Recalcule localement coupes, transitions et synchro avec le coefficient `k` (plus petit = plus de coupes). */
  setSensitivity(k: number): void {
    const base = this.baseAnalysis();
    if (!base || this.uploading()) return;
    const rebuilt = this.analyzer.rebuild(base, k);
    this.sensitivity.set(rebuilt.sensitivity);
    this.analysis.set(rebuilt);
  }

  onSensitivityInput(event: Event): void {
    const level = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(level)) this.setSensitivity(MIN_K + MAX_K - level);
  }

  private pushSample(sample: ClipAnalysisSample): void {
    this.liveBuffer.push(sample);
    if (this.liveFrame !== undefined) return;
    this.liveFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => this.flushLive())
        : setTimeout(() => this.flushLive(), FRAME_FALLBACK_MS);
  }

  /** Publie les échantillons reçus au plus une fois par image d'affichage. */
  private flushLive(): void {
    this.liveFrame = undefined;
    this.liveSamples.set([...this.liveBuffer]);
  }

  private cancelLiveFrame(): void {
    if (this.liveFrame === undefined) return;
    if (typeof cancelAnimationFrame === 'function' && typeof this.liveFrame === 'number') cancelAnimationFrame(this.liveFrame);
    clearTimeout(this.liveFrame as ReturnType<typeof setTimeout>);
    this.liveFrame = undefined;
  }

  private clearAnalysis(): void {
    this.cancelLiveFrame();
    this.liveBuffer = [];
    this.liveSamples.set([]);
    this.baseAnalysis.set(null);
    this.analysis.set(null);
    this.sensitivity.set(DEFAULT_K);
    this.analysisProgress.set(0);
    this.analysisError.set('');
    this.analysisNotice.set('');
    this.revokeFilmstrip();
  }

  private revokeFilmstrip(): void {
    const url = this.filmstripUrl();
    if (url) URL.revokeObjectURL(url);
    this.filmstripUrl.set('');
    this.filmstrip = null;
  }

  // --- Étiquettes -----------------------------------------------------------------------------

  onTagKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    this.commitTagDraft();
  }

  /** Une virgule tapée ou collée valide les étiquettes qui la précèdent. */
  onTagInput(): void {
    const value = this.tagDraft.value;
    if (!value.includes(',')) return;
    const parts = value.split(',');
    const rest = parts.pop() ?? '';
    for (const part of parts) this.addTag(part);
    this.tagDraft.setValue(rest);
  }

  /** Ajoute le brouillon ; `false` s'il est refusé. */
  commitTagDraft(): boolean {
    const added = this.addTag(this.tagDraft.value);
    if (added) this.tagDraft.setValue('');
    return added;
  }

  addTag(raw: string): boolean {
    const tag = normalizeTag(raw);
    if (!tag) return true;
    if (this.tags().includes(tag)) {
      this.tagMessage.set('');
      return true;
    }
    const error = tagError(tag, this.tags());
    this.tagMessage.set(error ?? '');
    if (error) return false;
    this.tags.update((tags) => [...tags, tag]);
    this.announcement.set(`Étiquette « ${tag} » ajoutée.`);
    return true;
  }

  removeTag(tag: string): void {
    this.tags.update((tags) => tags.filter((item) => item !== tag));
    this.tagMessage.set('');
    this.announcement.set(`Étiquette « ${tag} » retirée.`);
  }

  // --- Envoi ------------------------------------------------------------------------------------

  upload(): void {
    const file = this.file();
    const analysis = this.analysis();
    if (!file || !analysis || !this.canUpload()) return;
    if (!this.commitTagDraft()) return;

    this.uploading.set(true);
    this.uploadProgress.set(null);
    this.uploadError.set('');
    const submittedTitle = this.title.value.trim() || file.name.slice(0, TITLE_MAX_LENGTH);
    this.title.disable({ emitEvent: false });

    this.service
      .upload(file, submittedTitle, analysis, {
        filmstrip: this.filmstrip,
        tags: this.tags(),
        visibility: this.visibility.value,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            this.uploadProgress.set(event.total ? Math.min(PERCENT, Math.round((event.loaded / event.total) * PERCENT)) : null);
            return;
          }
          if (event.type !== HttpEventType.Response || !event.body) return;
          this.onUploaded(event.body);
        },
        error: (error: unknown) => {
          this.uploading.set(false);
          this.uploadProgress.set(null);
          this.title.enable({ emitEvent: false });
          this.uploadError.set(serverMessage(error, 'Envoi impossible, réessayez.'));
        },
      });
  }

  private onUploaded(created: Clip): void {
    this.uploading.set(false);
    this.uploadProgress.set(null);
    console.debug('[Studio] Extrait enregistré', created.id);
    this.snackBar
      .open(`« ${created.title} » a bien été enregistré.`, 'Ouvrir', { duration: SNACKBAR_SUCCESS_MS })
      .onAction()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.openClip(created));
    this.resetForm();
    this.lastCreated.set(created);
    this.page.set(1);
    this.refreshLibrary();
  }

  private resetForm(): void {
    this.title.enable({ emitEvent: false });
    this.title.reset('');
    this.tagDraft.reset('');
    this.tags.set([]);
    this.tagMessage.set('');
    this.visibility.reset('private');
    this.file.set(undefined);
    this.fileError.set('');
    this.clearAnalysis();
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  // --- Suppression ------------------------------------------------------------------------------

  remove(clip: ClipSummary): void {
    if (this.deletingId() || this.confirmingDelete) return;
    this.confirmingDelete = true;
    this.dialog
      .open<ConfirmDeleteDialogComponent, ConfirmDeleteDialogData, boolean>(ConfirmDeleteDialogComponent, {
        data: { title: clip.title, target: 'clip' },
        role: 'alertdialog',
        ariaModal: true,
        ariaDescribedBy: 'confirm-delete-description',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        panelClass: CONFIRM_DELETE_PANEL_CLASS,
        width: '28rem',
        maxWidth: 'calc(100vw - 2rem)',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (confirmed) => {
          this.confirmingDelete = false;
          if (confirmed === true) this.deleteClip(clip);
        },
        error: () => (this.confirmingDelete = false),
      });
  }

  private deleteClip(clip: ClipSummary): void {
    this.deletingId.set(clip.id);
    this.service
      .remove(clip.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deletingId.set('');
          this.selection.update((selected) => selected.filter((item) => item.id !== clip.id));
          this.snackBar.open(`« ${clip.title} » a été supprimé.`, 'Fermer', { duration: SNACKBAR_SUCCESS_MS });
          this.listHeading()?.nativeElement.focus();
          if (this.clips().length === 1 && this.page() > 1) this.page.update((current) => current - 1);
          this.refreshLibrary();
        },
        error: (error: unknown) => {
          this.deletingId.set('');
          const message =
            error instanceof HttpErrorResponse && error.status === 404
              ? 'Extrait introuvable ou déjà supprimé.'
              : serverMessage(error, 'Suppression impossible, réessayez.');
          this.snackBar.open(message, 'Fermer', { duration: SNACKBAR_ERROR_MS });
          this.load();
        },
      });
  }

  formatSize(bytes: number): string {
    return formatSize(bytes);
  }
}

/** Libellés français du paginator, adaptés aux extraits. */
function createClipsPaginatorIntl(): MatPaginatorIntl {
  const intl = createFrenchPaginatorIntl();
  intl.itemsPerPageLabel = 'Extraits par page :';
  return intl;
}

/** Validation client (confort) ; le serveur reste l'autorité. */
export function validateClipFile(file: File): string | undefined {
  const extension = fileExtension(file.name);
  const typeAccepted = file.type ? ALLOWED_MIME_TYPES.includes(file.type) : ALLOWED_EXTENSIONS.includes(extension);
  if (!typeAccepted) {
    return `Format non accepté (${file.type || extension || 'type inconnu'}). Formats autorisés : MP4, WebM.`;
  }
  if (file.size > MAX_CLIP_FILE_SIZE) {
    return `Fichier trop volumineux (${formatSize(file.size)}). Taille maximale : ${formatSize(MAX_CLIP_FILE_SIZE)}.`;
  }
  if (file.size === 0) return 'Le fichier sélectionné est vide.';
  return undefined;
}

function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} o`;
  if (bytes < BYTES_PER_KB * BYTES_PER_KB) return `${(bytes / BYTES_PER_KB).toFixed(1)} Ko`;
  return `${(bytes / (BYTES_PER_KB * BYTES_PER_KB)).toFixed(1)} Mo`;
}

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string } | null;
    if (typeof body?.message === 'string' && body.message) return body.message;
    if (error.status === 0) return 'Serveur injoignable, vérifiez votre connexion.';
  }
  return fallback;
}
