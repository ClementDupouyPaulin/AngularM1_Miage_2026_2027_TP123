import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { Clip, ClipPatch, ClipVisibility } from '../../shared/models/clip.model';
import { FriendUser } from '../../shared/models/friend.model';
import { ClipService } from '../../shared/services/clip.service';
import { FriendService } from '../../shared/services/friend.service';

/** Classe du panneau d'overlay, cible des styles (thème clair/sombre). */
export const SHARE_DIALOG_PANEL_CLASS = 'clip-share-dialog';

export interface ShareDialogData {
  clip: Clip;
}

export interface VisibilityOption {
  value: ClipVisibility;
  label: string;
  hint: string;
}

export const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  { value: 'private', label: 'Privé', hint: 'Vous seul voyez cet extrait.' },
  { value: 'shared', label: 'Partagé avec des amis', hint: 'Seuls les amis cochés le voient.' },
  { value: 'public', label: 'Public', hint: 'Tout utilisateur connecté le trouve dans Découvrir.' },
];

/** Corps du PATCH : la liste d'amis n'a de sens qu'en mode partagé, sinon elle est vidée. */
export function sharePatch(visibility: ClipVisibility, selected: readonly string[]): ClipPatch {
  return { visibility, sharedWith: visibility === 'shared' ? [...selected] : [] };
}

/**
 * Réglage de la visibilité d'un extrait (propriétaire seulement). Ferme avec
 * le `Clip` mis à jour ; Échap, clic extérieur ou « Annuler » ferment sans valeur.
 */
@Component({
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, RouterLink],
  templateUrl: './share-dialog.html',
  styleUrl: './share-dialog.css',
  encapsulation: ViewEncapsulation.None,
})
export class ShareDialogComponent {
  private readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ShareDialogComponent, Clip>>(MatDialogRef);
  private readonly clips = inject(ClipService);
  private readonly friendService = inject(FriendService);
  private readonly destroyRef = inject(DestroyRef);

  readonly options = VISIBILITY_OPTIONS;
  readonly title = this.data.clip.title;
  readonly visibility = signal<ClipVisibility>(this.data.clip.visibility);
  readonly selected = signal<ReadonlySet<string>>(new Set(this.data.clip.sharedWith.map((user) => user.id)));
  readonly friends = signal<FriendUser[]>([]);
  readonly friendsLoading = signal(true);
  readonly friendsError = signal('');
  readonly saving = signal(false);
  readonly error = signal('');

  readonly needsFriends = computed(() => this.visibility() === 'shared' && this.selected().size === 0);

  constructor() {
    this.friendService
      .overview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (overview) => {
          const friends = overview.friends.map((entry) => entry.user);
          const known = new Set(friends.map((friend) => friend.id));
          // Un ancien ami retiré ne doit pas rester coché : le serveur refuserait le PATCH.
          this.selected.update((ids) => new Set([...ids].filter((id) => known.has(id))));
          this.friends.set(friends);
          this.friendsLoading.set(false);
        },
        error: (error: unknown) => {
          console.debug('[Montage] Amis indisponibles', error);
          this.friendsLoading.set(false);
          this.friendsError.set('Impossible de charger vos amis, réessayez plus tard.');
        },
      });
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggleFriend(id: string, checked: boolean): void {
    this.selected.update((ids) => {
      const next = new Set(ids);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  save(): void {
    if (this.saving()) return;
    if (this.needsFriends()) {
      this.error.set('Cochez au moins un ami, ou choisissez une autre visibilité.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.clips
      .patch(this.data.clip.id, sharePatch(this.visibility(), [...this.selected()]))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (clip) => this.dialogRef.close(clip),
        error: (error: unknown) => {
          this.saving.set(false);
          this.error.set(this.saveErrorMessage(error));
        },
      });
  }

  private saveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 400 && typeof error.error?.message === 'string') return error.error.message;
      if (error.status === 404) return 'Extrait introuvable : il a peut-être été supprimé.';
      if (error.status === 0) return 'Serveur injoignable, réessayez plus tard.';
    }
    return 'Le partage n’a pas pu être enregistré.';
  }
}
