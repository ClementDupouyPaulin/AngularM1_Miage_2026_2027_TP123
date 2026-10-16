import { HttpErrorResponse } from '@angular/common/http';
import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { CoverCandidate } from '../../../shared/models/cover-candidate.model';
import { CoverSearchResult } from '../../../shared/models/cover-search-result.model';
import { TrackService } from '../../../shared/services/track.service';

/** Classe du panneau d'overlay, cible des styles (thème clair/sombre). */
export const COVER_SEARCH_PANEL_CLASS = 'cover-search-dialog';

export interface CoverSearchDialogData {
  trackId: string;
  title: string;
}

/**
 * Recherche de pochettes sur le Web (iTunes, via le backend). La requête part
 * uniquement à l'ouverture du dialogue ou sur « Réessayer » : jamais de
 * recherche automatique. Le dialogue se ferme avec le candidat retenu ; c'est
 * la page qui applique ensuite la pochette.
 */
@Component({
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose],
  templateUrl: './cover-search-dialog.html',
  styleUrl: './cover-search-dialog.css',
  encapsulation: ViewEncapsulation.None,
})
export class CoverSearchDialogComponent {
  readonly data = inject<CoverSearchDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(TrackService);
  private readonly dialogRef = inject<MatDialogRef<CoverSearchDialogComponent, CoverCandidate>>(
    MatDialogRef,
  );

  readonly loading = signal(false);
  readonly error = signal('');
  readonly result = signal<CoverSearchResult | undefined>(undefined);
  readonly selected = signal<CoverCandidate | undefined>(undefined);

  readonly announcement = computed(() => {
    if (this.loading()) return 'Recherche de pochettes en cours…';
    const result = this.result();
    if (!result) return '';
    const count = result.results.length;
    if (count === 0) return 'Aucune pochette trouvée.';
    return count === 1 ? '1 pochette trouvée.' : `${count} pochettes trouvées.`;
  });

  private readonly searches = new Subject<void>();

  constructor() {
    this.searches
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set('');
          this.selected.set(undefined);
        }),
        switchMap(() =>
          this.service.searchCover(this.data.trackId).pipe(
            catchError((error: unknown) => {
              console.error('[CoverSearch] Recherche impossible', error);
              this.loading.set(false);
              this.result.set(undefined);
              this.error.set(this.errorMessage(error));
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (result) => {
          console.debug('[CoverSearch] Candidats reçus', result.results.length);
          this.result.set(result);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          console.error('[CoverSearch] Flux de recherche interrompu', error);
          this.loading.set(false);
          this.error.set('La recherche de pochettes est indisponible.');
        },
      });

    this.search();
  }

  /** Lance (ou relance après une erreur) la recherche. */
  search(): void {
    this.searches.next();
  }

  select(candidate: CoverCandidate): void {
    this.selected.set(candidate);
  }

  /** Confirmation explicite : ferme le dialogue avec le candidat retenu. */
  confirm(): void {
    const candidate = this.selected();
    if (candidate) this.dialogRef.close(candidate);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 502) {
        return 'Le service de recherche de pochettes (iTunes) est momentanément indisponible. Réessayez dans un instant.';
      }
      if (error.status === 404) return 'Piste introuvable ou déjà supprimée.';
      if (error.status === 401) return 'Session expirée : reconnectez-vous pour chercher une pochette.';
      if (error.status === 0) return 'Serveur injoignable, recherche impossible.';
      const body = error.error as { message?: string } | null;
      if (typeof body?.message === 'string' && body.message) return body.message;
    }
    return 'Recherche impossible, réessayez.';
  }
}
