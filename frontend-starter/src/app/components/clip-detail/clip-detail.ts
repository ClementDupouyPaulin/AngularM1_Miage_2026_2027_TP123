import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  EMPTY,
  MonoTypeOperatorFunction,
  Observable,
  Subject,
  catchError,
  filter,
  map,
  merge,
  pipe,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { MAX_K, MIN_K } from '../../shared/analysis/cut-detector';
import { rhythmProfile } from '../../shared/analysis/rhythm';
import { estimateTempo } from '../../shared/analysis/tempo';
import { VISIBILITY_LABELS, formatDecimal, interpretSyncScore } from '../../shared/format/clip-format';
import { Clip, ClipAnalysis, ClipAnnotation } from '../../shared/models/clip.model';
import { AuthService } from '../../shared/services/auth.service';
import { ClipAnalyzerService } from '../../shared/services/clip-analyzer.service';
import { ClipService } from '../../shared/services/clip.service';
import { AccelerationChartComponent } from '../acceleration-chart/acceleration-chart';
import { FilmstripComponent } from '../filmstrip/filmstrip';
import { PaletteBandComponent } from '../palette-band/palette-band';
import { PulseTimelineComponent, formatTimecode } from '../pulse-timeline/pulse-timeline';
import {
  SHARE_DIALOG_PANEL_CLASS,
  ShareDialogComponent,
  ShareDialogData,
} from '../share-dialog/share-dialog';
import { ShotHistogramComponent } from '../shot-histogram/shot-histogram';
import {
  CONFIRM_DELETE_PANEL_CLASS,
  ConfirmDeleteDialogComponent,
  ConfirmDeleteDialogData,
} from '../tracks-page/confirm-delete-dialog/confirm-delete-dialog';
import {
  ANNOTATION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  annotationTime,
  parseTags,
  sortAnnotations,
  tagsError,
  tempoComparison,
} from './montage';
import {
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  analysisJson,
  drawPulseImage,
  exportFileName,
  readExportTheme,
} from './pulse-export';
import { VideoPlayerComponent } from './video-player/video-player';

export { PREVIOUS_CUT_MARGIN_SEC, interpretSyncScore, nextCut, previousCut } from './montage';
export type { SyncInterpretation } from './montage';

/** Pas du curseur de sensibilité (le serveur accepte tout k de [1, 6]). */
export const SENSITIVITY_STEP = 0.5;
const NOT_BLANK = /\S/;
/** Délai avant révocation de l'URL d'un téléchargement, le temps que le navigateur la lise. */
const DOWNLOAD_REVOKE_DELAY_MS = 1000;

type MediaAsset = { kind: 'video' | 'filmstrip'; blob: Blob };

interface StatCard {
  label: string;
  value: string;
  hint: string;
}

/** Salle de montage (`/clips/:id`) : lecteur, pouls, analyse réglable, annotations, partage et export. */
@Component({
  imports: [
    DatePipe,
    RouterLink,
    ReactiveFormsModule,
    VideoPlayerComponent,
    PulseTimelineComponent,
    FilmstripComponent,
    PaletteBandComponent,
    ShotHistogramComponent,
    AccelerationChartComponent,
  ],
  templateUrl: './clip-detail.html',
  styleUrl: './clip-detail.css',
})
export class ClipDetailComponent {
  private readonly service = inject(ClipService);
  private readonly analyzer = inject(ClipAnalyzerService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Émet à chaque changement d'`:id` : coupe les requêtes lancées pour l'extrait précédent. */
  private readonly clipChange = new Subject<void>();

  private readonly player = viewChild(VideoPlayerComponent);
  private readonly annotationInput = viewChild<ElementRef<HTMLTextAreaElement>>('annotationInput');

  readonly minK = MIN_K;
  readonly maxK = MAX_K;
  readonly sensitivityStep = SENSITIVITY_STEP;
  readonly annotationMaxLength = ANNOTATION_MAX_LENGTH;
  readonly titleMaxLength = TITLE_MAX_LENGTH;
  readonly formatTimecode = formatTimecode;

  readonly clip = signal<Clip | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly videoUrl = signal('');
  readonly videoLoading = signal(false);
  readonly videoError = signal('');
  readonly filmstripUrl = signal('');
  readonly currentTime = signal(0);

  /** Analyse re-détectée localement, tant qu'elle n'est ni enregistrée ni annulée. */
  readonly preview = signal<ClipAnalysis | null>(null);
  readonly sensitivity = signal(0);
  readonly savingAnalysis = signal(false);
  readonly analysisMessage = signal('');

  readonly annotationDraftTime = signal<number | null>(null);
  readonly annotationSaving = signal(false);
  readonly annotationError = signal('');
  readonly announcement = signal('');
  readonly annotationText = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(ANNOTATION_MAX_LENGTH), Validators.pattern(NOT_BLANK)],
  });
  readonly annotationLength = signal(0);

  readonly editing = signal(false);
  readonly metaSaving = signal(false);
  readonly metaError = signal('');
  readonly metaForm = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(TITLE_MAX_LENGTH), Validators.pattern(NOT_BLANK)],
    }),
    tags: new FormControl('', { nonNullable: true }),
  });

  readonly exportMessage = signal('');
  readonly actionError = signal('');
  readonly deleting = signal(false);

  readonly analysis = computed(() => this.preview() ?? this.clip()?.analysis ?? null);
  readonly isOwner = computed(() => this.clip()?.isOwner ?? false);
  readonly dirty = computed(() => this.preview() !== null);
  readonly canRedetect = computed(() => (this.clip()?.analysis.diffs.length ?? 0) > 0);
  readonly cuts = computed(() => this.analysis()?.cuts ?? []);
  readonly fadeCount = computed(
    () => this.analysis()?.transitions.filter((transition) => transition.kind === 'fade').length ?? 0,
  );
  readonly rhythm = computed(() => {
    const analysis = this.analysis();
    return analysis ? rhythmProfile(analysis.cuts, analysis.durationSec) : null;
  });
  readonly tempo = computed(() => estimateTempo(this.analysis()?.beats ?? []));
  readonly sortedAnnotations = computed(() => sortAnnotations(this.clip()?.annotations ?? []));
  readonly draftTimeLabel = computed(() =>
    formatTimecode(this.annotationDraftTime() ?? this.currentTime(), true),
  );
  readonly sensitivityLabel = computed(() => formatDecimal(this.sensitivity(), 1));

  readonly ownerBadge = computed(() => {
    const clip = this.clip();
    if (!clip) return '';
    return clip.isOwner ? 'Propriétaire' : `Partagé par ${clip.owner.name}`;
  });

  readonly visibilityLabel = computed(() => {
    const clip = this.clip();
    if (!clip) return '';
    const label = VISIBILITY_LABELS[clip.visibility];
    const count = clip.sharedWith.length;
    return clip.isOwner && clip.visibility === 'shared' ? `${label} (${count} ami${count > 1 ? 's' : ''})` : label;
  });

  readonly stats = computed<StatCard[]>(() => {
    const analysis = this.analysis();
    const rhythm = this.rhythm();
    if (!analysis || !rhythm) return [];
    const cutCount = analysis.cuts.length;
    const sync = interpretSyncScore(analysis.syncScore);
    const bpm = this.tempo();
    return [
      { label: 'Durée', value: formatTimecode(analysis.durationSec), hint: `${formatDecimal(analysis.durationSec, 1)} s` },
      { label: 'Coupes', value: String(cutCount), hint: `${cutCount + 1} plans` },
      { label: 'Fondus', value: String(this.fadeCount()), hint: 'Transitions progressives' },
      { label: 'Plan moyen', value: `${formatDecimal(rhythm.averageShotLength, 1)} s`, hint: 'Durée moyenne d’un plan' },
      { label: 'Plan médian', value: `${formatDecimal(rhythm.medianShotLength, 1)} s`, hint: 'La moitié des plans sont plus courts' },
      { label: 'Coupes / minute', value: formatDecimal(rhythm.cutsPerMinute, 1), hint: 'Cadence du montage' },
      { label: 'Profil de rythme', value: rhythm.label, hint: 'D’après la durée moyenne des plans' },
      { label: 'Tempo musique', value: bpm === null ? '—' : `${bpm} BPM`, hint: tempoComparison(bpm, rhythm.cutsPerMinute) },
      { label: 'Synchro coupes / musique', value: sync.value, hint: sync.verdict },
      { label: 'Beats', value: String(analysis.beats.length), hint: 'Temps forts de la bande-son' },
    ];
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.revokeUrls());
    this.annotationText.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((text) => this.annotationLength.set(text.length));

    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        tap(() => this.reset()),
        switchMap((id) => this.load(id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((asset) => this.applyAsset(asset));
  }

  onPlayerTime(time: number): void {
    this.currentTime.set(time);
  }

  seekTo(time: number): void {
    const player = this.player();
    if (player) player.seekTo(time);
    else this.currentTime.set(time);
  }

  // ----- Sensibilité -----

  onSensitivityInput(value: number | string): void {
    const clip = this.clip();
    const k = Number(value);
    if (!clip || !Number.isFinite(k)) return;
    this.sensitivity.set(k);
    this.analysisMessage.set('');
    this.preview.set(k === clip.analysis.sensitivity ? null : this.analyzer.rebuild(clip.analysis, k));
  }

  resetAnalysis(): void {
    const clip = this.clip();
    if (!clip) return;
    this.preview.set(null);
    this.sensitivity.set(clip.analysis.sensitivity);
    this.analysisMessage.set('Réglage d’origine rétabli.');
  }

  saveAnalysis(): void {
    const clip = this.clip();
    const preview = this.preview();
    if (!clip || !preview || !clip.isOwner || this.savingAnalysis()) return;
    const sentSensitivity = this.sensitivity();
    this.savingAnalysis.set(true);
    this.analysisMessage.set('');
    this.service
      .updateAnalysis(clip.id, preview)
      .pipe(this.whileSameClip())
      .subscribe({
        next: (updated) => {
          console.debug('[Montage] Analyse enregistrée', updated.id, updated.analysis.sensitivity);
          this.applySavedAnalysis(updated, sentSensitivity);
          this.savingAnalysis.set(false);
          this.analysisMessage.set(`Analyse enregistrée : ${updated.analysis.cuts.length} coupes.`);
        },
        error: (error: unknown) => {
          this.savingAnalysis.set(false);
          this.analysisMessage.set(this.actionErrorMessage(error, 'L’analyse n’a pas pu être enregistrée.'));
        },
      });
  }

  // ----- Annotations -----

  onAnnotateAt(time: number): void {
    this.annotationDraftTime.set(time);
    this.annotationInput()?.nativeElement.focus();
  }

  useCurrentTime(): void {
    this.annotationDraftTime.set(null);
  }

  canDeleteAnnotation(annotation: ClipAnnotation): boolean {
    return this.isOwner() || annotation.authorId === this.auth.currentUser()?.id;
  }

  addAnnotation(): void {
    const clip = this.clip();
    if (!clip || this.annotationSaving()) return;
    if (this.annotationText.invalid) {
      this.annotationText.markAsTouched();
      this.annotationError.set(`Écrivez entre 1 et ${ANNOTATION_MAX_LENGTH} caractères.`);
      return;
    }
    const time = annotationTime(this.annotationDraftTime() ?? this.currentTime(), clip.durationSec);
    this.annotationSaving.set(true);
    this.annotationError.set('');
    this.service
      .addAnnotation(clip.id, { time, text: this.annotationText.value.trim() })
      .pipe(this.whileSameClip())
      .subscribe({
        next: (annotation) => {
          this.clip.update((current) =>
            current ? { ...current, annotations: [...current.annotations, annotation] } : current,
          );
          this.annotationSaving.set(false);
          this.annotationDraftTime.set(null);
          this.annotationText.reset('');
          this.announcement.set(`Annotation ajoutée à ${formatTimecode(annotation.time, true)}.`);
        },
        error: (error: unknown) => {
          this.annotationSaving.set(false);
          this.annotationError.set(this.actionErrorMessage(error, 'L’annotation n’a pas pu être ajoutée.'));
        },
      });
  }

  removeAnnotation(annotation: ClipAnnotation): void {
    const clip = this.clip();
    if (!clip) return;
    this.service
      .removeAnnotation(clip.id, annotation.id)
      .pipe(this.whileSameClip())
      .subscribe({
        next: () => {
          this.clip.update((current) =>
            current
              ? { ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) }
              : current,
          );
          this.announcement.set(`Annotation de ${formatTimecode(annotation.time, true)} supprimée.`);
        },
        error: (error: unknown) => {
          this.announcement.set(this.actionErrorMessage(error, 'L’annotation n’a pas pu être supprimée.'));
        },
      });
  }

  // ----- Métadonnées, partage, suppression -----

  startEditing(): void {
    const clip = this.clip();
    if (!clip) return;
    this.metaForm.setValue({ title: clip.title, tags: clip.tags.join(', ') });
    this.metaError.set('');
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
    this.metaError.set('');
  }

  saveMetadata(): void {
    const clip = this.clip();
    if (!clip || this.metaSaving()) return;
    const tags = parseTags(this.metaForm.controls.tags.value);
    const invalidTags = tagsError(tags);
    if (this.metaForm.invalid || invalidTags) {
      this.metaForm.markAllAsTouched();
      this.metaError.set(invalidTags ?? `Le titre doit faire entre 1 et ${TITLE_MAX_LENGTH} caractères.`);
      return;
    }
    this.metaSaving.set(true);
    this.metaError.set('');
    this.service
      .patch(clip.id, { title: this.metaForm.controls.title.value.trim(), tags })
      .pipe(this.whileSameClip())
      .subscribe({
        next: (updated) => {
          this.applyClip(updated, true);
          this.metaSaving.set(false);
          this.editing.set(false);
          this.announcement.set('Titre et étiquettes enregistrés.');
        },
        error: (error: unknown) => {
          this.metaSaving.set(false);
          this.metaError.set(this.actionErrorMessage(error, 'Les modifications n’ont pas pu être enregistrées.'));
        },
      });
  }

  openShare(): void {
    const clip = this.clip();
    if (!clip?.isOwner) return;
    this.dialog
      .open<ShareDialogComponent, ShareDialogData, Clip>(ShareDialogComponent, {
        data: { clip },
        ariaModal: true,
        ariaDescribedBy: 'share-dialog-description',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        panelClass: SHARE_DIALOG_PANEL_CLASS,
        width: 'min(32rem, 94vw)',
      })
      .afterClosed()
      .pipe(
        filter((updated): updated is Clip => !!updated),
        this.whileSameClip(),
      )
      .subscribe((updated) => {
        this.applyClip(updated, true);
        this.announcement.set(`Visibilité : ${VISIBILITY_LABELS[updated.visibility]}.`);
      });
  }

  confirmDelete(): void {
    const clip = this.clip();
    if (!clip?.isOwner || this.deleting()) return;
    this.dialog
      .open<ConfirmDeleteDialogComponent, ConfirmDeleteDialogData, boolean>(ConfirmDeleteDialogComponent, {
        data: { title: clip.title, target: 'clip' },
        role: 'alertdialog',
        ariaModal: true,
        ariaDescribedBy: 'confirm-delete-description',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        panelClass: CONFIRM_DELETE_PANEL_CLASS,
      })
      .afterClosed()
      .pipe(
        filter((confirmed) => confirmed === true),
        tap(() => {
          this.deleting.set(true);
          this.actionError.set('');
        }),
        switchMap(() => this.service.remove(clip.id)),
        this.whileSameClip(),
      )
      .subscribe({
        next: () => {
          console.debug('[Montage] Extrait supprimé', clip.id);
          void this.router.navigate(['/clips']);
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          this.actionError.set(this.actionErrorMessage(error, 'La suppression a échoué.'));
        },
      });
  }

  // ----- Export -----

  exportPng(): void {
    const clip = this.clip();
    const analysis = this.analysis();
    if (!clip || !analysis) return;
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) {
      this.exportMessage.set('Votre navigateur ne permet pas de générer l’image.');
      return;
    }
    // Lu sur l'hôte : les variables héritées reflètent le thème sombre ou clair actif.
    const style = getComputedStyle(this.host.nativeElement);
    const theme = readExportTheme((name) => style.getPropertyValue(name));
    drawPulseImage(context, { title: clip.title, timeSec: this.currentTime(), analysis }, theme);
    canvas.toBlob((blob) => {
      if (!blob) {
        this.exportMessage.set('L’image n’a pas pu être générée.');
        return;
      }
      this.download(blob, exportFileName(clip.title, 'pouls', 'png'));
      this.exportMessage.set('Image du pouls téléchargée.');
    }, 'image/png');
  }

  exportJson(): void {
    const clip = this.clip();
    const analysis = this.analysis();
    if (!clip || !analysis) return;
    const blob = new Blob([analysisJson(analysis)], { type: 'application/json' });
    this.download(blob, exportFileName(clip.title, 'analyse', 'json'));
    this.exportMessage.set('Données de l’analyse téléchargées.');
  }

  // ----- Chargement -----

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    // Révocation différée : le téléchargement doit d'abord avoir lu l'URL.
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);
  }

  /** Applique un extrait reçu du serveur ; `keepPreview` garde un réglage local non enregistré. */
  private applyClip(clip: Clip, keepPreview = false): void {
    this.clip.set(clip);
    if (keepPreview && this.preview()) return;
    this.preview.set(null);
    this.sensitivity.set(clip.analysis.sensitivity);
  }

  /** Limite une requête à l'extrait affiché : annulée au changement d'`:id` comme à la destruction. */
  private whileSameClip<T>(): MonoTypeOperatorFunction<T> {
    return pipe(takeUntil(this.clipChange), takeUntilDestroyed(this.destroyRef));
  }

  /**
   * Après « Enregistrer » : le réglage local n'est effacé que s'il n'a pas bougé
   * pendant l'envoi ; sinon il reste en aperçu, sauf s'il rejoint la valeur enregistrée.
   */
  private applySavedAnalysis(updated: Clip, sentSensitivity: number): void {
    const changedMeanwhile = this.sensitivity() !== sentSensitivity;
    this.applyClip(updated, changedMeanwhile);
    if (changedMeanwhile && this.sensitivity() === updated.analysis.sensitivity) this.preview.set(null);
  }

  private reset(): void {
    this.clipChange.next();
    this.revokeUrls();
    this.clip.set(null);
    this.preview.set(null);
    this.loading.set(true);
    this.error.set('');
    this.videoLoading.set(false);
    this.videoError.set('');
    this.currentTime.set(0);
    this.editing.set(false);
    this.annotationDraftTime.set(null);
    this.analysisMessage.set('');
    this.exportMessage.set('');
    this.actionError.set('');
    this.savingAnalysis.set(false);
    this.annotationSaving.set(false);
    this.annotationError.set('');
    this.metaSaving.set(false);
    this.metaError.set('');
    this.deleting.set(false);
  }

  /** Extrait, puis vidéo et pellicule en parallèle ; n'émet que les `Blob`, les erreurs sont affichées. */
  private load(id: string): Observable<MediaAsset> {
    if (!id) {
      this.loading.set(false);
      this.error.set('Extrait introuvable.');
      return EMPTY;
    }
    return this.service.get(id).pipe(
      tap((clip) => {
        console.debug('[Montage] Extrait chargé', clip.id);
        this.applyClip(clip);
        this.loading.set(false);
        this.videoLoading.set(true);
      }),
      catchError((error: unknown) => {
        console.error('[Montage] Chargement impossible', error);
        this.loading.set(false);
        this.error.set(this.loadErrorMessage(error));
        return EMPTY;
      }),
      switchMap((clip) => merge(this.loadVideo(id), clip.hasFilmstrip ? this.loadFilmstrip(id) : EMPTY)),
    );
  }

  private loadVideo(id: string): Observable<MediaAsset> {
    return this.service.video(id).pipe(
      map((blob): MediaAsset => ({ kind: 'video', blob })),
      catchError((error: unknown) => {
        console.error('[Montage] Vidéo indisponible', error);
        this.videoLoading.set(false);
        this.videoError.set(this.videoErrorMessage(error));
        return EMPTY;
      }),
    );
  }

  private loadFilmstrip(id: string): Observable<MediaAsset> {
    return this.service.filmstrip(id).pipe(
      map((blob): MediaAsset => ({ kind: 'filmstrip', blob })),
      catchError((error: unknown) => {
        // Sans pellicule, la timeline et la bande d'images restent utilisables (vignettes absentes).
        console.debug('[Montage] Pellicule indisponible', error);
        return EMPTY;
      }),
    );
  }

  private applyAsset(asset: MediaAsset): void {
    const target = asset.kind === 'video' ? this.videoUrl : this.filmstripUrl;
    const previous = target();
    if (previous) URL.revokeObjectURL(previous);
    target.set(URL.createObjectURL(asset.blob));
    if (asset.kind === 'video') this.videoLoading.set(false);
  }

  private revokeUrls(): void {
    for (const url of [this.videoUrl, this.filmstripUrl]) {
      const value = url();
      if (!value) continue;
      URL.revokeObjectURL(value);
      url.set('');
    }
  }

  private loadErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) return 'Extrait introuvable : il a été supprimé ou ne vous est pas partagé.';
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

  private actionErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 400 && typeof error.error?.message === 'string') return error.error.message;
      if (error.status === 401) return 'Session expirée : reconnectez-vous.';
      if (error.status === 403 || error.status === 404) return 'Action non autorisée sur cet extrait.';
      if (error.status === 0) return 'Serveur injoignable, réessayez plus tard.';
    }
    return fallback;
  }
}
