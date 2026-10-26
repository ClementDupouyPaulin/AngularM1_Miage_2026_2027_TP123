import { DatePipe } from '@angular/common';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, debounceTime, filter, map, merge, switchMap, tap } from 'rxjs';
import { averageShotLength } from '../../shared/analysis/shot-length';
import { SYNC_ALIGNED_THRESHOLD } from '../../shared/analysis/sync-score';
import { ClipAnalysis, ClipSummary } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import {
  ClipAnalysisError,
  ClipAnalyzerService,
  MAX_CLIP_DURATION_SEC,
} from '../../shared/services/clip-analyzer.service';
import { ClipService } from '../../shared/services/clip.service';
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

/** Délai d'anti-rebond du filtre : une requête par pause de frappe. */
export const SEARCH_DEBOUNCE_MS = 300;

const SEARCH_MAX_LENGTH = 100;

const PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 20];

const MAX_SKELETONS = 6;

const SECONDS_PER_MINUTE = 60;
const BYTES_PER_KB = 1024;
const SNACKBAR_SUCCESS_MS = 4000;
const SNACKBAR_ERROR_MS = 6000;

/** Libellé lisible du score de synchronisation coupes/musique. */
export function syncScoreLabel(score: number | null): string {
  if (score === null) return 'bande-son non analysable';
  return score >= SYNC_ALIGNED_THRESHOLD ? 'calé sur la musique' : 'sans lien avec la musique';
}

/** Durée en `m:ss`. */
export function formatDuration(totalSec: number): string {
  const seconds = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/** Page « Mes extraits » : analyse locale d'une vidéo, envoi, liste paginée serveur. */
@Component({
  imports: [ReactiveFormsModule, DatePipe, MatPaginator, RouterLink],
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

  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly resultHeading = viewChild<ElementRef<HTMLElement>>('resultHeading');

  // --- Liste paginée ---------------------------------------------------------
  readonly clips = signal<ClipSummary[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly total = signal(0);
  readonly limit = signal(5);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly searchMaxLength = SEARCH_MAX_LENGTH;
  readonly titleMaxLength = TITLE_MAX_LENGTH;
  readonly maxDurationSec = MAX_CLIP_DURATION_SEC;

  readonly skeletons = computed(() =>
    Array.from({ length: Math.min(this.limit(), MAX_SKELETONS) }, (_, index) => index),
  );

  readonly search = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(SEARCH_MAX_LENGTH)],
  });
  readonly searchText = toSignal(this.search.valueChanges, { initialValue: this.search.value });
  readonly query = signal('');
  private readonly searchNow = new Subject<void>();

  readonly resultsAnnouncement = computed(() => {
    if (this.loading() || this.error()) return '';
    const total = this.total();
    const query = this.query();
    if (query) {
      const found =
        total === 0 ? 'Aucun extrait trouvé' : total === 1 ? '1 extrait trouvé' : `${total} extraits trouvés`;
      return `${found} pour « ${query} ».`;
    }
    return total === 1 ? '1 extrait enregistré.' : `${total} extraits enregistrés.`;
  });

  // --- Sélection du fichier --------------------------------------------------
  readonly title = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(TITLE_MAX_LENGTH)],
  });
  private readonly titleStatus = toSignal(this.title.statusChanges, {
    initialValue: this.title.status,
  });
  readonly file = signal<File | undefined>(undefined);
  readonly fileError = signal('');
  readonly dragging = signal(false);

  // --- Analyse ---------------------------------------------------------------
  readonly analyzing = signal(false);
  /** Pourcentage 0-100 de l'analyse en cours. */
  readonly analysisProgress = signal(0);
  readonly analysis = signal<ClipAnalysis | null>(null);
  readonly analysisError = signal('');
  readonly analysisNotice = signal('');
  private abortController: AbortController | undefined;

  readonly cutCount = computed(() => this.analysis()?.cuts.length ?? 0);
  readonly beatCount = computed(() => this.analysis()?.beats.length ?? 0);
  readonly avgShot = computed(() => {
    const result = this.analysis();
    return result ? averageShotLength(result.cuts, result.durationSec) : 0;
  });
  readonly syncLabel = computed(() => syncScoreLabel(this.analysis()?.syncScore ?? null));

  // --- Envoi -----------------------------------------------------------------
  readonly uploading = signal(false);
  /** `null` tant que le total d'octets est inconnu (barre indéterminée). */
  readonly uploadProgress = signal<number | null>(null);
  readonly uploadError = signal('');

  readonly busy = computed(() => this.analyzing() || this.uploading());

  readonly canAnalyze = computed(
    () => !this.busy() && this.file() !== undefined && !this.fileError() && this.analysis() === null,
  );

  readonly canUpload = computed(
    () => !this.busy() && this.analysis() !== null && this.titleStatus() !== 'INVALID',
  );

  // --- Suppression -----------------------------------------------------------
  readonly deletingId = signal('');
  private confirmingDelete = false;

  readonly maxFileSizeLabel = formatSize(MAX_CLIP_FILE_SIZE);
  readonly acceptAttribute = [...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS].join(',');

  readonly formatDuration = formatDuration;
  readonly syncScoreLabel = syncScoreLabel;

  constructor() {
    merge(this.search.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS)), this.searchNow)
      .pipe(
        map(() => this.search.value.trim()),
        filter((query) => query !== this.query() && query.length <= SEARCH_MAX_LENGTH),
        tap((query) => {
          this.query.set(query);
          this.page.set(1);
        }),
        switchMap((query) => {
          const sequence = this.beginLoad();
          return this.service.list(1, this.limit(), query).pipe(
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

    this.destroyRef.onDestroy(() => this.abortController?.abort());

    this.load();
  }

  // --- Liste -------------------------------------------------------------------

  /** Seule la réponse du dernier chargement lancé écrit dans les signaux. */
  private loadSequence = 0;

  load(): void {
    const sequence = this.beginLoad();
    this.service
      .list(this.page(), this.limit(), this.query())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.applyPage(sequence, response),
        error: (error: unknown) => this.applyLoadError(sequence, error),
      });
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
    if (this.loading()) return;
    if (event.pageSize !== this.limit()) {
      this.limit.set(event.pageSize);
      this.page.set(1);
    } else {
      this.page.set(event.pageIndex + 1);
    }
    this.load();
  }

  backToFirstPage(): void {
    this.page.set(1);
    this.load();
  }

  clearSearch(): void {
    this.search.setValue('');
    this.searchNow.next();
    this.searchInput()?.nativeElement.focus();
  }

  // --- Sélection -----------------------------------------------------------------

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

  selectFile(file: File | undefined): void {
    if (this.busy()) return;
    this.file.set(file);
    this.fileError.set(file ? (validateClipFile(file) ?? '') : '');
    this.analysis.set(null);
    this.analysisError.set('');
    this.analysisNotice.set('');
    this.analysisProgress.set(0);
    this.uploadError.set('');
  }

  // --- Analyse ---------------------------------------------------------------------

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
    this.analyzing.set(true);
    this.analysisProgress.set(0);
    this.analysisError.set('');
    this.analysisNotice.set('');

    try {
      const result = await this.analyzer.analyze(file, {
        signal: controller.signal,
        onProgress: (ratio) => this.analysisProgress.set(Math.round(Math.min(1, Math.max(0, ratio)) * 100)),
      });
      this.analysis.set(result);
      this.analysisNotice.set('Analyse terminée.');
      queueMicrotask(() => this.resultHeading()?.nativeElement.focus());
    } catch (error: unknown) {
      this.applyAnalysisError(error);
    } finally {
      this.analyzing.set(false);
      if (this.abortController === controller) this.abortController = undefined;
    }
  }

  cancelAnalysis(): void {
    this.abortController?.abort();
  }

  private applyAnalysisError(error: unknown): void {
    if (error instanceof ClipAnalysisError) {
      if (error.code === 'aborted') {
        this.analysisNotice.set(error.message);
        this.analysisProgress.set(0);
        return;
      }
      this.analysisError.set(error.message);
      return;
    }
    console.error('[ClipsPage] Analyse impossible', error);
    this.analysisError.set('Analyse impossible, réessayez avec une autre vidéo.');
  }

  // --- Envoi -----------------------------------------------------------------------

  upload(): void {
    const file = this.file();
    const analysis = this.analysis();
    if (!file || !analysis || !this.canUpload()) return;

    this.uploading.set(true);
    this.uploadProgress.set(null);
    this.uploadError.set('');
    const submittedTitle = this.title.value.trim() || file.name;
    this.title.disable({ emitEvent: false });

    this.service
      .upload(file, submittedTitle, analysis)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            this.uploadProgress.set(
              event.total ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : null,
            );
            return;
          }
          if (event.type !== HttpEventType.Response) return;
          this.uploading.set(false);
          this.uploadProgress.set(null);
          this.snackBar.open(
            `« ${event.body?.title ?? submittedTitle} » a bien été enregistré.`,
            'Fermer',
            { duration: SNACKBAR_SUCCESS_MS },
          );
          this.resetForm();
          this.page.set(1);
          this.load();
        },
        error: (error: unknown) => {
          this.uploading.set(false);
          this.uploadProgress.set(null);
          this.title.enable({ emitEvent: false });
          this.uploadError.set(serverMessage(error, 'Envoi impossible, réessayez.'));
        },
      });
  }

  private resetForm(): void {
    this.title.enable({ emitEvent: false });
    this.title.reset('');
    this.file.set(undefined);
    this.fileError.set('');
    this.analysis.set(null);
    this.analysisNotice.set('');
    this.analysisProgress.set(0);
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  // --- Suppression -------------------------------------------------------------------

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
          this.snackBar.open(`« ${clip.title} » a été supprimé.`, 'Fermer', {
            duration: SNACKBAR_SUCCESS_MS,
          });
          this.listHeading()?.nativeElement.focus();
          if (this.clips().length === 1 && this.page() > 1) {
            this.page.update((current) => current - 1);
          }
          this.load();
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

  formatDecimal(value: number, digits: number): string {
    return value.toFixed(digits).replace('.', ',');
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
  const typeAccepted = file.type
    ? ALLOWED_MIME_TYPES.includes(file.type)
    : ALLOWED_EXTENSIONS.includes(extension);
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
