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
import {
  EMPTY,
  Subject,
  catchError,
  debounceTime,
  filter,
  map,
  merge,
  switchMap,
  tap,
} from 'rxjs';
import { CoverCandidate } from '../../shared/models/cover-candidate.model';
import { Page } from '../../shared/models/page.model';
import { CoverSource, Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';
import { COVER_ACCEPT_ATTRIBUTE, validateCoverFile } from './cover-file';
import { fileExtension } from './file-extension';
import {
  COVER_SEARCH_PANEL_CLASS,
  CoverSearchDialogComponent,
  CoverSearchDialogData,
} from './cover-search-dialog/cover-search-dialog';
import { TrackCoverComponent } from './track-cover/track-cover';
import {
  CONFIRM_DELETE_PANEL_CLASS,
  ConfirmDeleteDialogComponent,
  ConfirmDeleteDialogData,
} from './confirm-delete-dialog/confirm-delete-dialog';
import { createFrenchPaginatorIntl } from './french-paginator-intl';

/**
 * Taille maximale acceptée, alignée sur le backend :
 * `const MAX_FILE_SIZE = 25 * 1024 * 1024;` (backend/src/app.js:35), appliquée
 * par Multer via `limits: { fileSize: MAX_FILE_SIZE }` (backend/src/app.js:357).
 */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Types MIME acceptés, copiés à l'identique du `Set allowed`
 * (backend/src/app.js:38-45) utilisé par le `fileFilter` de Multer.
 */
const ALLOWED_MIME_TYPES: readonly string[] = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
];

/**
 * Extensions correspondantes. Certains navigateurs/OS renvoient un
 * `File.type` vide ; on retombe alors sur l'extension plutôt que de bloquer un
 * fichier que le backend accepterait. C'est le backend qui reste l'autorité.
 */
const ALLOWED_EXTENSIONS: readonly string[] = ['.mp3', '.wav', '.ogg', '.m4a', '.mp4'];

/** Délai d'anti-rebond du filtre : une requête par pause de frappe, pas par touche. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Longueur maximale du filtre, alignée sur le contrat (`q` > 100 caractères = 400). */
const SEARCH_MAX_LENGTH = 100;

/** Tailles de page proposées par le paginator (toutes servies par le backend). */
const PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 20];

/** Nombre maximal de cartes squelettes affichées pendant le premier chargement. */
const MAX_SKELETONS = 6;

/** Libellés lisibles de l'origine d'une pochette. */
const COVER_SOURCE_LABELS: Record<CoverSource, string> = {
  upload: 'Importée',
  id3: 'Tags ID3',
  web: 'Web (iTunes)',
};

/** Page « Ma bibliothèque » : liste paginée serveur, filtre, upload et lecture audio. */
@Component({
  imports: [ReactiveFormsModule, DatePipe, MatPaginator, TrackCoverComponent],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
  providers: [{ provide: MatPaginatorIntl, useFactory: createFrenchPaginatorIntl }],
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  /** Référence au champ fichier du DOM, pour pouvoir réellement le vider. */
  private readonly fileInput =
    viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Champ pochette du formulaire d'upload, vidé après envoi ou retrait. */
  private readonly coverInput =
    viewChild<ElementRef<HTMLInputElement>>('coverInput');

  /** Sélecteur de fichier partagé par les boutons « Changer la pochette ». */
  private readonly coverPicker =
    viewChild<ElementRef<HTMLInputElement>>('coverPicker');

  /** Titre de la liste : point de repli du focus quand une card disparaît. */
  private readonly libraryHeading =
    viewChild<ElementRef<HTMLElement>>('libraryHeading');

  /** Champ de filtre, pour y rendre le focus après « Effacer ». */
  private readonly searchInput =
    viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // --- Mission 2 : bibliothèque paginée ------------------------------------
  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly total = signal(0);
  readonly limit = signal(5);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly hasPrevious = computed(() => this.page() > 1 && !this.loading());
  readonly hasNext = computed(() => this.page() < this.pages() && !this.loading());

  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly searchMaxLength = SEARCH_MAX_LENGTH;

  /** Cartes squelettes du premier chargement, autant que de pistes attendues. */
  readonly skeletons = computed(() =>
    Array.from({ length: Math.min(this.limit(), MAX_SKELETONS) }, (_, index) => index),
  );

  // --- Filtre par titre (côté serveur, paramètre `q`) -----------------------
  /** Saisie en cours ; le filtre réellement appliqué est `query`. */
  readonly search = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(SEARCH_MAX_LENGTH)],
  });
  readonly searchText = toSignal(this.search.valueChanges, {
    initialValue: this.search.value,
  });
  /** Filtre appliqué à la dernière requête (rogné, `''` = aucun filtre). */
  readonly query = signal('');

  /** Annonce lue par les lecteurs d'écran une fois la liste chargée. */
  readonly resultsAnnouncement = computed(() => {
    if (this.loading() || this.error()) return '';
    const total = this.total();
    const query = this.query();
    if (query) {
      const found =
        total === 0
          ? 'Aucune piste trouvée'
          : total === 1
            ? '1 piste trouvée'
            : `${total} pistes trouvées`;
      return `${found} pour « ${query} ».`;
    }
    return total === 1 ? '1 piste dans votre bibliothèque.' : `${total} pistes dans votre bibliothèque.`;
  });

  /** Application immédiate du filtre (bouton « Effacer »), sans attendre l'anti-rebond. */
  private readonly searchNow = new Subject<void>();

  // --- Mission 3 : upload ---------------------------------------------------
  readonly title = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(120)],
  });
  readonly uploading = signal(false);
  readonly uploadError = signal('');
  readonly uploadSuccess = signal('');

  /**
   * Fichier choisi. C'est un signal (et non une propriété simple) pour que
   * `canUpload` recalcule réellement à chaque sélection de fichier.
   */
  readonly file = signal<File | undefined>(undefined);

  /**
   * `FormControl` n'expose pas sa validité sous forme de signal : on projette
   * donc `statusChanges` pour pouvoir la consommer dans un `computed()`.
   */
  private readonly titleStatus = toSignal(this.title.statusChanges, {
    initialValue: this.title.status,
  });

  /**
   * Progression de l'upload : `null` au repos et quand le total est inconnu
   * (état indéterminé), sinon un pourcentage 0-100 d'octets **transmis**.
   * 100 % ne signifie pas que le serveur a accepté la piste.
   */
  readonly uploadProgress = signal<number | null>(null);

  /** Un fichier est survolé au-dessus de la zone de dépôt. */
  readonly dragging = signal(false);

  // --- Pochette optionnelle à l'upload --------------------------------------
  readonly coverFile = signal<File | undefined>(undefined);
  /** Aperçu local (ObjectURL), révoqué à chaque remplacement, retrait ou envoi. */
  readonly coverPreviewUrl = signal('');
  readonly coverError = signal('');
  readonly coverAcceptAttribute = COVER_ACCEPT_ATTRIBUTE;

  // --- Pochettes des pistes --------------------------------------------------
  /** Piste dont la pochette est en cours de modification (anti double-clic). */
  readonly coverBusyId = signal('');
  /**
   * Version d'affichage de la pochette par piste : la route `/cover` ne change
   * pas après une modification, cette clé force donc le rechargement de l'image.
   */
  readonly coverVersions = signal<Readonly<Record<string, number>>>({});
  /** Piste ciblée par le sélecteur de fichier « Changer la pochette ». */
  private coverTarget: Track | undefined;
  /** Un dialogue de pochette est ouvert : un second clic l'ignore. */
  private coverDialogOpen = false;

  /**
   * Bouton « Envoyer » actif seulement si rien n'est en cours, qu'un fichier
   * est choisi et que le titre est valide. Ce n'est qu'un confort : `upload()`
   * revalide le **fichier** (taille et type, `validateFile()`) mais pas le
   * titre — pour le titre, ce bouton est la seule barrière côté client, et le
   * backend reste l'autorité finale.
   */
  readonly canUpload = computed(
    () =>
      !this.uploading() &&
      this.file() !== undefined &&
      this.titleStatus() !== 'INVALID',
  );

  // --- Mission 5 : suppression ---------------------------------------------
  /** Identifiant de la piste en cours de suppression (garde anti-double-clic). */
  readonly deletingId = signal('');

  /** Un dialogue de confirmation est déjà ouvert : un second clic l'ignore. */
  private confirmingDelete = false;

  // --- Mission 3 : lecture audio -------------------------------------------
  readonly audioUrl = signal('');
  readonly playingTrack = signal<Track | undefined>(undefined);
  readonly audioLoadingId = signal('');
  readonly audioError = signal('');

  /**
   * Toutes les demandes de lecture passent par ce Subject : `switchMap` annule
   * la requête précédente, donc une réponse tardive ne peut plus écraser la
   * plus récente si l'utilisateur enchaîne deux morceaux.
   */
  private readonly playRequests = new Subject<Track>();

  readonly maxFileSizeLabel = this.formatSize(MAX_FILE_SIZE);
  readonly acceptAttribute = [...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS].join(',');

  constructor() {
    this.playRequests
      .pipe(
        tap((track) => {
          this.audioError.set('');
          this.audioLoadingId.set(track.id);
        }),
        switchMap((track) =>
          this.service.audio(track.id).pipe(
            map((blob) => ({ track, blob })),
            catchError((error: unknown) => {
              console.error('[TracksPage] Lecture impossible', error);
              this.audioLoadingId.set('');
              this.audioError.set(
                this.audioErrorMessage(error, track.title),
              );
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: ({ track, blob }) => {
          console.debug('[TracksPage] Audio chargé', track.id);
          this.revokeAudioUrl();
          this.audioUrl.set(URL.createObjectURL(blob));
          this.playingTrack.set(track);
          this.audioLoadingId.set('');
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Flux de lecture interrompu', error);
          this.audioLoadingId.set('');
          this.audioError.set('La lecture audio est indisponible.');
        },
      });

    // Filtre : l'anti-rebond regroupe la frappe, puis switchMap annule la
    // requête du filtre précédent encore en vol. La valeur relue est celle du
    // champ au moment de l'émission : un « Effacer » entre-temps l'emporte.
    merge(
      this.search.valueChanges.pipe(debounceTime(SEARCH_DEBOUNCE_MS)),
      this.searchNow,
    )
      .pipe(
        map(() => this.search.value.trim()),
        filter((query) => query !== this.query() && query.length <= SEARCH_MAX_LENGTH),
        tap((query) => {
          console.debug('[TracksPage] Filtre appliqué', query);
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
      .subscribe({
        next: ({ sequence, response }) => this.applyPage(sequence, response),
        error: (error: unknown) => {
          console.error('[TracksPage] Flux de filtre interrompu', error);
          this.loading.set(false);
          this.error.set('Le filtre est indisponible.');
        },
      });

    // L'ObjectURL finale doit être libérée : sans cela le Blob reste retenu
    // par le document jusqu'au rechargement complet de la page.
    this.destroyRef.onDestroy(() => {
      this.revokeAudioUrl();
      this.revokeCoverPreview();
    });

    this.load();
  }

  // --- Bibliothèque --------------------------------------------------------

  /**
   * Numéro du dernier chargement lancé. Deux `load()` peuvent se chevaucher
   * (une suppression confirmée pendant un changement de page, par exemple) :
   * seule la réponse du dernier appel émis a le droit d'écrire dans les
   * signaux, sinon une réponse plus ancienne mais arrivée en retard afficherait
   * un état périmé.
   */
  private loadSequence = 0;

  /**
   * Charge la page courante depuis le serveur (une requête HTTP par page).
   * `allowPageFallback` autorise un seul repli sur la dernière page valide
   * quand la page demandée n'existe plus (pistes supprimées ailleurs) : le
   * rechargement de repli passe `false`, aucune boucle n'est donc possible.
   */
  load(allowPageFallback = true): void {
    const sequence = this.beginLoad();
    const requestedPage = this.page();

    // takeUntilDestroyed : si l'utilisateur quitte /tracks pendant la requête,
    // la réponse n'écrit plus dans les signaux d'un composant détruit.
    this.service
      .list(requestedPage, this.limit(), this.query())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (
            allowPageFallback &&
            sequence === this.loadSequence &&
            this.isBeyondLastPage(requestedPage, response)
          ) {
            console.warn('[TracksPage] Page hors bornes, repli sur la page', response.pages);
            // Total et nombre de pages à jour immédiatement, puis un seul rechargement.
            this.applyPage(sequence, response);
            this.page.set(response.pages);
            this.load(false);
            return;
          }
          this.applyPage(sequence, response);
        },
        error: (error: unknown) => this.applyLoadError(sequence, error),
      });
  }

  /** Page vide alors que des pistes existent : la page demandée a disparu. */
  private isBeyondLastPage(requestedPage: number, response: Page<Track>): boolean {
    return (
      response.items.length === 0 &&
      response.total > 0 &&
      response.pages >= 1 &&
      requestedPage > response.pages
    );
  }

  private beginLoad(): number {
    this.loading.set(true);
    this.error.set('');
    return ++this.loadSequence;
  }

  private applyPage(sequence: number, response: Page<Track>): void {
    if (sequence !== this.loadSequence) return;
    console.debug('[TracksPage] Pistes chargées', response.items.length);
    this.tracks.set(response.items);
    this.pages.set(response.pages);
    this.total.set(response.total);
    this.page.set(response.page);
    this.loading.set(false);
  }

  private applyLoadError(sequence: number, error: unknown): void {
    if (sequence !== this.loadSequence) return;
    console.error('[TracksPage] Chargement impossible', error);
    this.error.set(this.serverMessage(error, 'Impossible de charger la bibliothèque.'));
    this.tracks.set([]);
    this.loading.set(false);
  }

  /** Change de page en restant dans les bornes, puis relance une requête. */
  go(page: number): void {
    const target = Math.min(Math.max(1, page), this.pages());
    if (target === this.page() || this.loading()) return;

    this.page.set(target);
    this.load();
  }

  /** Sortie de secours d'une page vide alors que des pistes existent. */
  backToFirstPage(): void {
    this.page.set(1);
    this.load();
  }

  /**
   * Événement du `MatPaginator`. Changer la taille ramène en page 1 (l'ancien
   * numéro de page n'a plus de sens) ; dans tous les cas une seule requête
   * serveur est émise, jamais de découpage local.
   */
  onPage(event: PageEvent): void {
    if (event.pageSize !== this.limit()) {
      if (this.loading()) return;
      this.limit.set(event.pageSize);
      this.page.set(1);
      this.load();
      return;
    }
    this.go(event.pageIndex + 1);
  }

  /** Vide le filtre et l'applique aussitôt, puis rend le focus au champ. */
  clearSearch(): void {
    this.search.setValue('');
    this.searchNow.next();
    this.searchInput()?.nativeElement.focus();
  }

  // --- Upload ---------------------------------------------------------------

  choose(event: Event): void {
    this.selectFile((event.target as HTMLInputElement).files?.[0]);
  }

  onDragOver(event: DragEvent): void {
    if (this.uploading()) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  /** Dépôt d'un fichier : même traitement qu'une sélection via le champ. */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.uploading()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.selectFile(file);
  }

  private selectFile(file: File | undefined): void {
    this.file.set(file);
    this.uploadSuccess.set('');
    // Retour immédiat sur un fichier refusé ; upload() revalide de toute façon.
    this.uploadError.set(file ? (this.validateFile(file) ?? '') : '');
    console.debug('[TracksPage] Fichier sélectionné', file?.name);
  }

  upload(): void {
    // Double garde : un clic pendant un envoi en cours est ignoré, en plus du
    // bouton désactivé dans le template.
    if (this.uploading()) {
      console.warn('[TracksPage] Envoi déjà en cours, clic ignoré');
      return;
    }

    this.uploadSuccess.set('');

    const file = this.file();
    if (!file) {
      this.uploadError.set('Choisissez un fichier audio avant d’envoyer.');
      return;
    }

    const invalid = this.validateFile(file);
    if (invalid) {
      console.warn('[TracksPage] Fichier refusé côté frontend', invalid);
      this.uploadError.set(invalid);
      return;
    }

    this.uploadError.set('');
    this.uploading.set(true);
    // `null` au démarrage : aucun octet mesuré encore, état indéterminé.
    this.uploadProgress.set(null);

    const submittedTitle = this.title.value.trim() || file.name;
    // Champ titre verrouillé pendant l'envoi (le champ fichier et le bouton
    // le sont via `uploading()` dans le template).
    this.title.disable({ emitEvent: false });

    // La désinscription à la destruction annule l'abonnement côté client ; la
    // requête déjà partie peut aboutir côté serveur, la piste sera simplement
    // visible au prochain chargement de la liste. C'est le comportement voulu.
    this.service
      .upload(file, submittedTitle, this.coverFile())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            // `total` peut être absent (taille non annoncée) : dans ce cas on
            // reste en indéterminé plutôt que d'afficher un faux pourcentage.
            if (event.total) {
              this.uploadProgress.set(
                Math.min(100, Math.round((event.loaded / event.total) * 100)),
              );
            } else {
              this.uploadProgress.set(null);
            }
            return;
          }

          // Seul HttpEventType.Response prouve que le serveur a accepté la
          // piste : 100 % d'octets envoyés n'est pas une réussite serveur.
          if (event.type !== HttpEventType.Response) return;

          const track = event.body;
          console.debug('[TracksPage] Piste envoyée', track?.id);
          this.uploading.set(false);
          this.uploadProgress.set(null);
          this.uploadSuccess.set(
            `« ${track?.title ?? file.name} » a bien été ajouté à votre bibliothèque.`,
          );
          this.resetUploadForm();
          this.page.set(1);
          this.load();
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Envoi impossible', error);
          this.uploading.set(false);
          this.uploadProgress.set(null);
          this.title.enable({ emitEvent: false });
          this.uploadError.set(
            this.serverMessage(error, 'Envoi impossible, réessayez.'),
          );
        },
      });
  }

  // --- Suppression ----------------------------------------------------------

  /**
   * Supprime une piste après confirmation explicite dans un `MatDialog`.
   * Si l'utilisateur annule (bouton, Échap, clic extérieur), aucune requête
   * DELETE n'est émise.
   */
  remove(track: Track): void {
    if (this.deletingId() || this.confirmingDelete || this.coverBusyId() === track.id) {
      console.warn('[TracksPage] Suppression déjà en cours, clic ignoré');
      return;
    }

    this.confirmingDelete = true;
    this.dialog
      .open<ConfirmDeleteDialogComponent, ConfirmDeleteDialogData, boolean>(
        ConfirmDeleteDialogComponent,
        {
          data: { title: track.title },
          role: 'alertdialog',
          ariaModal: true,
          ariaDescribedBy: 'confirm-delete-description',
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          panelClass: CONFIRM_DELETE_PANEL_CLASS,
          width: '28rem',
          maxWidth: 'calc(100vw - 2rem)',
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (confirmed) => {
          this.confirmingDelete = false;
          if (confirmed !== true) {
            console.debug('[TracksPage] Suppression annulée par l’utilisateur', track.id);
            return;
          }
          this.deleteTrack(track);
        },
        error: (error: unknown) => {
          this.confirmingDelete = false;
          console.error('[TracksPage] Dialogue de confirmation interrompu', error);
        },
      });
  }

  private deleteTrack(track: Track): void {
    this.deletingId.set(track.id);

    // Le backend répond 204 sans corps : on ne lit donc aucun body ici.
    this.service
      .remove(track.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          console.debug('[TracksPage] Piste supprimée', track.id);
          this.deletingId.set('');

          // Le lecteur ne doit pas rester sur une ressource disparue.
          if (this.playingTrack()?.id === track.id) {
            this.revokeAudioUrl();
            this.playingTrack.set(undefined);
            this.audioError.set('');
          }

          this.snackBar.open(`« ${track.title} » a été supprimé.`, 'Fermer', {
            duration: 4000,
          });
          // La card (et son bouton focalisé) va disparaître : le focus clavier
          // est déplacé vers le titre de la liste plutôt que perdu sur <body>.
          this.libraryHeading()?.nativeElement.focus();

          // Dernière piste d'une page non initiale : revenir à la page précédente
          // plutôt que d'afficher une page vide.
          if (this.tracks().length === 1 && this.page() > 1) {
            this.page.update((current) => current - 1);
          }
          this.load();
        },
        error: (error: unknown) => {
          console.error('[TracksPage] Suppression impossible', error);
          this.deletingId.set('');
          this.snackBar.open(this.deleteErrorMessage(error), 'Fermer', {
            duration: 6000,
          });
          // La liste peut être désynchronisée (piste déjà supprimée ailleurs).
          this.load();
        },
      });
  }

  /**
   * Le backend filtre sur `ownerId` : une piste inexistante et une piste
   * appartenant à autrui renvoient toutes deux `404 { message: "Piste inconnue" }`
   * (backend/src/app.js:691-698). Le client ne peut pas les distinguer, d'où un
   * message honnête plutôt qu'une affirmation fausse.
   */
  private deleteErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return 'Piste introuvable ou déjà supprimée.';
      }
      if (error.status === 401) {
        return 'Session expirée : reconnectez-vous pour supprimer une piste.';
      }
      if (error.status === 0) {
        return 'Serveur injoignable, suppression impossible.';
      }
    }
    return this.serverMessage(error, 'Suppression impossible, réessayez.');
  }

  /**
   * Validation frontend, alignée sur le backend. Elle évite un aller-retour
   * réseau inutile mais ne remplace jamais la vérification serveur : elle est
   * entièrement contournable (requête forgée, DevTools, client tiers).
   */
  private validateFile(file: File): string | undefined {
    const extension = fileExtension(file.name);
    const typeAccepted = file.type
      ? ALLOWED_MIME_TYPES.includes(file.type)
      : ALLOWED_EXTENSIONS.includes(extension);

    if (!typeAccepted) {
      return `Format non accepté (${file.type || extension || 'type inconnu'}). Formats autorisés : MP3, WAV, OGG, M4A.`;
    }

    if (file.size > MAX_FILE_SIZE) {
      return `Fichier trop volumineux (${this.formatSize(file.size)}). Taille maximale : ${this.maxFileSizeLabel}.`;
    }

    if (file.size === 0) {
      return 'Le fichier sélectionné est vide.';
    }

    return undefined;
  }

  /** Vide le titre, la référence interne ET les champs fichier affichés. */
  private resetUploadForm(): void {
    this.title.enable({ emitEvent: false });
    this.title.reset('');
    this.file.set(undefined);

    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
    this.clearCover();
  }

  // --- Pochette optionnelle de l'upload -------------------------------------

  chooseCover(event: Event): void {
    this.selectCover((event.target as HTMLInputElement).files?.[0]);
  }

  /** Retient l'image si elle est valide et en prépare l'aperçu local. */
  selectCover(file: File | undefined): void {
    this.revokeCoverPreview();
    this.coverFile.set(undefined);
    this.coverError.set('');
    if (!file) return;

    const invalid = validateCoverFile(file);
    if (invalid) {
      console.warn('[TracksPage] Pochette refusée côté frontend', invalid);
      this.coverError.set(invalid);
      this.resetCoverInput();
      return;
    }

    this.coverFile.set(file);
    this.coverPreviewUrl.set(URL.createObjectURL(file));
    console.debug('[TracksPage] Pochette sélectionnée', file.name);
  }

  /** Retire la pochette choisie (l'upload repart alors sans champ `cover`). */
  clearCover(): void {
    this.revokeCoverPreview();
    this.coverFile.set(undefined);
    this.coverError.set('');
    this.resetCoverInput();
  }

  private resetCoverInput(): void {
    const input = this.coverInput()?.nativeElement;
    if (input) input.value = '';
  }

  private revokeCoverPreview(): void {
    const url = this.coverPreviewUrl();
    if (!url) return;
    URL.revokeObjectURL(url);
    this.coverPreviewUrl.set('');
  }

  // --- Pochettes des pistes ---------------------------------------------------

  coverVersion(id: string): number {
    return this.coverVersions()[id] ?? 0;
  }

  coverSourceLabel(source: CoverSource | null): string {
    return source ? COVER_SOURCE_LABELS[source] : '';
  }

  /** « Changer la pochette » : ouvre le sélecteur de fichier pour cette piste. */
  pickCover(track: Track): void {
    if (this.isCoverLocked()) return;
    this.coverTarget = track;
    this.coverPicker()?.nativeElement.click();
  }

  onCoverPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const track = this.coverTarget;
    input.value = '';
    this.coverTarget = undefined;
    if (file && track) this.changeCover(track, file);
  }

  /** Remplace la pochette par une image locale (`PUT /api/tracks/:id/cover`). */
  changeCover(track: Track, file: File): void {
    if (this.isCoverLocked()) return;

    const invalid = validateCoverFile(file);
    if (invalid) {
      console.warn('[TracksPage] Pochette refusée côté frontend', invalid);
      this.snackBar.open(invalid, 'Fermer', { duration: 6000 });
      return;
    }

    this.coverBusyId.set(track.id);
    this.service
      .setCover(track.id, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => this.coverUpdated(updated, `La pochette de « ${updated.title} » a été mise à jour.`),
        error: (error: unknown) => this.coverFailed(error, 'Mise à jour de la pochette impossible.'),
      });
  }

  /** Retire la pochette après confirmation dans le dialogue accessible. */
  removeCover(track: Track): void {
    if (this.isCoverLocked()) return;

    this.coverDialogOpen = true;
    this.dialog
      .open<ConfirmDeleteDialogComponent, ConfirmDeleteDialogData, boolean>(
        ConfirmDeleteDialogComponent,
        {
          data: { title: track.title, target: 'cover' },
          role: 'alertdialog',
          ariaModal: true,
          ariaDescribedBy: 'confirm-delete-description',
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          panelClass: CONFIRM_DELETE_PANEL_CLASS,
          width: '28rem',
          maxWidth: 'calc(100vw - 2rem)',
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (confirmed) => {
          this.coverDialogOpen = false;
          if (confirmed !== true) {
            console.debug('[TracksPage] Retrait de pochette annulé', track.id);
            return;
          }
          this.deleteCover(track);
        },
        error: (error: unknown) => {
          this.coverDialogOpen = false;
          console.error('[TracksPage] Dialogue de confirmation interrompu', error);
        },
      });
  }

  private deleteCover(track: Track): void {
    this.coverBusyId.set(track.id);
    this.service
      .removeCover(track.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // 204 sans corps : la piste est mise à jour localement.
        next: () =>
          this.coverUpdated(
            { ...track, hasCover: false, coverSource: null },
            `La pochette de « ${track.title} » a été retirée.`,
          ),
        error: (error: unknown) => this.coverFailed(error, 'Retrait de la pochette impossible.'),
      });
  }

  /** « Chercher sur le Web » : la recherche ne part qu'à l'ouverture du dialogue. */
  searchCover(track: Track): void {
    if (this.isCoverLocked()) return;

    this.coverDialogOpen = true;
    this.dialog
      .open<CoverSearchDialogComponent, CoverSearchDialogData, CoverCandidate>(
        CoverSearchDialogComponent,
        {
          data: { trackId: track.id, title: track.title },
          ariaModal: true,
          ariaDescribedBy: 'cover-search-description',
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          panelClass: COVER_SEARCH_PANEL_CLASS,
          width: '42rem',
          maxWidth: 'calc(100vw - 2rem)',
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (candidate) => {
          this.coverDialogOpen = false;
          if (!candidate?.imageUrl) {
            console.debug('[TracksPage] Recherche de pochette fermée sans choix', track.id);
            return;
          }
          this.applyWebCover(track, candidate.imageUrl);
        },
        error: (error: unknown) => {
          this.coverDialogOpen = false;
          console.error('[TracksPage] Dialogue de recherche interrompu', error);
        },
      });
  }

  private applyWebCover(track: Track, imageUrl: string): void {
    this.coverBusyId.set(track.id);
    this.service
      .setCoverFromWeb(track.id, imageUrl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => this.coverUpdated(updated, `Nouvelle pochette appliquée à « ${updated.title} ».`),
        error: (error: unknown) => this.coverFailed(error, 'Impossible d’utiliser cette pochette.'),
      });
  }

  /** Une seule opération de pochette à la fois, ni pendant une suppression. */
  private isCoverLocked(): boolean {
    if (this.coverBusyId() || this.coverDialogOpen || this.deletingId()) {
      console.warn('[TracksPage] Opération de pochette déjà en cours, clic ignoré');
      return true;
    }
    return false;
  }

  /**
   * Remplace la piste DANS la liste à partir de la réponse : ni rechargement
   * complet, ni changement de page. La clé de version force l'image à suivre.
   */
  private coverUpdated(updated: Track, message: string): void {
    console.debug('[TracksPage] Pochette modifiée', updated.id);
    this.coverBusyId.set('');
    this.tracks.update((tracks) => tracks.map((track) => (track.id === updated.id ? updated : track)));
    if (this.playingTrack()?.id === updated.id) this.playingTrack.set(updated);
    this.coverVersions.update((versions) => ({
      ...versions,
      [updated.id]: (versions[updated.id] ?? 0) + 1,
    }));
    this.snackBar.open(message, 'Fermer', { duration: 4000 });
  }

  private coverFailed(error: unknown, fallback: string): void {
    console.error('[TracksPage] Opération de pochette impossible', error);
    this.coverBusyId.set('');
    const notFound = error instanceof HttpErrorResponse && error.status === 404;
    this.snackBar.open(
      notFound ? 'Piste introuvable ou déjà supprimée.' : this.serverMessage(error, fallback),
      'Fermer',
      { duration: 6000 },
    );
    // Piste disparue entre-temps : on resynchronise la liste.
    if (notFound) this.load();
  }

  // --- Lecture --------------------------------------------------------------

  play(track: Track): void {
    console.debug('[TracksPage] Demande de lecture', track.id);
    this.playRequests.next(track);
  }

  /** Erreur remontée par l'élément `<audio>` lui-même (codec illisible…). */
  onAudioError(): void {
    const title = this.playingTrack()?.title;
    console.error('[TracksPage] Le lecteur audio a échoué', title);
    this.audioError.set(
      title
        ? `Le navigateur ne parvient pas à lire « ${title} ». Le format est peut-être non supporté.`
        : 'Le navigateur ne parvient pas à lire ce morceau.',
    );
  }

  private revokeAudioUrl(): void {
    const url = this.audioUrl();
    if (!url) return;

    URL.revokeObjectURL(url);
    this.audioUrl.set('');
    console.debug('[TracksPage] ObjectURL révoquée');
  }

  // --- Utilitaires ----------------------------------------------------------

  /** Le backend renvoie `size` en octets : on l'affiche en o / Ko / Mo. */
  formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  /** « audio/mpeg » → « MPEG », pour un affichage lisible du format. */
  formatKind(mimeType: string): string {
    const subtype = mimeType.split('/')[1] ?? mimeType;
    return subtype.replace(/^x-/, '').toUpperCase();
  }

  /** Extrait le message renvoyé par le backend, avec un repli explicite. */
  private serverMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { message?: string } | null;
      if (typeof body?.message === 'string' && body.message) return body.message;
      if (error.status === 0) {
        return 'Serveur injoignable, vérifiez votre connexion.';
      }
    }
    return fallback;
  }

  /**
   * Sur un appel `responseType: 'blob'`, le corps d'erreur est un `Blob` et non
   * un JSON : on traduit donc le statut HTTP en message lisible.
   */
  private audioErrorMessage(error: unknown, title: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return `« ${title} » est introuvable ou ne vous appartient pas.`;
      }
      if (error.status === 401) {
        return 'Session expirée : reconnectez-vous pour écouter vos morceaux.';
      }
      if (error.status === 0) {
        return 'Serveur injoignable, lecture impossible.';
      }
    }
    return `Impossible de charger l’audio de « ${title} ».`;
  }
}
