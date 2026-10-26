import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import {
  ActivityEvent,
  FriendEntry,
  FriendRequest,
} from '../../shared/models/friend.model';
import { ActivityService } from '../../shared/services/activity.service';
import { FriendService } from '../../shared/services/friend.service';
import {
  REMOVE_FRIEND_PANEL_CLASS,
  RemoveFriendDialogComponent,
  RemoveFriendDialogData,
} from './remove-friend-dialog/remove-friend-dialog';
import { fullDate, initials, monthYear, relativeTime } from './social-format';

export const EMAIL_MAX_LENGTH = 254;
export const ACTIVITY_LIMIT = 20;
const SNACK_DURATION_MS = 4000;
const SKELETON_COUNT = 3;

export function inviteErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 409) {
      return 'Cette personne est déjà votre amie, ou une invitation est déjà en attente entre vous.';
    }
    if (error.status === 400) {
      return 'Invitation impossible : vérifiez l’adresse. Vous ne pouvez pas vous inviter vous-même.';
    }
    if (error.status === 0) return 'Le serveur est injoignable. Réessayez dans un instant.';
  }
  return 'L’invitation n’a pas pu être envoyée.';
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse && error.status === 0) {
    return 'Le serveur est injoignable. Réessayez dans un instant.';
  }
  if (error instanceof HttpErrorResponse && error.status === 404) {
    return 'Cette invitation ou cette amitié n’existe plus.';
  }
  return fallback;
}

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './friends-page.html',
  styleUrl: './friends-page.css',
})
export class FriendsPageComponent {
  private readonly friendService = inject(FriendService);
  private readonly activityService = inject(ActivityService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly initials = initials;
  readonly monthYear = monthYear;
  readonly fullDate = fullDate;
  readonly emailMaxLength = EMAIL_MAX_LENGTH;
  readonly skeletons = Array.from({ length: SKELETON_COUNT }, (_, index) => index);

  readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email, Validators.maxLength(EMAIL_MAX_LENGTH)],
  });
  readonly submitted = signal(false);
  readonly inviting = signal(false);
  readonly inviteMessage = signal('');
  readonly inviteError = signal('');

  readonly friends = signal<FriendEntry[]>([]);
  readonly requests = signal<FriendRequest[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly busyId = signal('');

  readonly activity = signal<ActivityEvent[]>([]);
  readonly activityLoading = signal(true);
  readonly activityError = signal('');
  readonly now = signal(Date.now());

  readonly announcement = signal('');

  readonly incoming = computed(() => this.requests().filter((r) => r.direction === 'incoming'));
  readonly outgoing = computed(() => this.requests().filter((r) => r.direction === 'outgoing'));

  constructor() {
    this.loadOverview();
    this.loadActivity();
  }

  emailError(): string {
    if (!this.submitted() && !this.email.touched) return '';
    if (this.email.hasError('required')) return 'Saisissez l’adresse e-mail de votre ami.';
    if (this.email.hasError('email')) return 'Cette adresse e-mail n’est pas valide.';
    if (this.email.hasError('maxlength')) return 'Cette adresse est trop longue.';
    return '';
  }

  invite(event?: Event): void {
    event?.preventDefault();
    this.submitted.set(true);
    this.inviteMessage.set('');
    this.inviteError.set('');
    if (this.email.invalid || this.inviting()) {
      this.email.markAsTouched();
      return;
    }
    const email = this.email.value.trim();
    this.inviting.set(true);
    console.debug('[Social] Invitation envoyée');
    this.friendService
      .invite(email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.inviting.set(false);
          this.submitted.set(false);
          this.email.reset('');
          this.inviteMessage.set(response.message);
          this.loadOverview();
        },
        error: (error: unknown) => {
          this.inviting.set(false);
          this.inviteError.set(inviteErrorMessage(error));
        },
      });
  }

  accept(request: FriendRequest): void {
    if (this.busyId()) return;
    this.busyId.set(request.id);
    this.friendService
      .accept(request.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entry) => {
          this.busyId.set('');
          this.dropRequest(request.id);
          this.friends.update((list) => [entry, ...list.filter((f) => f.friendshipId !== entry.friendshipId)]);
          this.notify(`Vous êtes maintenant ami avec ${entry.user.name}.`);
          this.loadActivity();
        },
        error: (error: unknown) => this.failAction(error, 'L’invitation n’a pas pu être acceptée.'),
      });
  }

  decline(request: FriendRequest): void {
    this.removeRequest(request, `Invitation de ${request.user.name} refusée.`, 'Le refus a échoué.');
  }

  cancel(request: FriendRequest): void {
    this.removeRequest(request, `Invitation à ${request.user.name} annulée.`, 'L’annulation a échoué.');
  }

  removeFriend(entry: FriendEntry): void {
    if (this.busyId()) return;
    this.dialog
      .open<RemoveFriendDialogComponent, RemoveFriendDialogData, boolean>(RemoveFriendDialogComponent, {
        data: { name: entry.user.name },
        role: 'alertdialog',
        ariaModal: true,
        ariaDescribedBy: 'remove-friend-description',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        panelClass: REMOVE_FRIEND_PANEL_CLASS,
        width: '28rem',
        maxWidth: 'calc(100vw - 2rem)',
      })
      .afterClosed()
      .pipe(
        filter((confirmed) => confirmed === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.confirmRemoveFriend(entry));
  }

  loadActivity(): void {
    this.activityLoading.set(true);
    this.activityError.set('');
    this.activityService
      .recent(ACTIVITY_LIMIT)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (events) => {
          this.now.set(Date.now());
          this.activity.set(events);
          this.activityLoading.set(false);
          this.announcement.set(
            events.length === 0 ? 'Aucune activité récente.' : `Fil d’activité à jour : ${events.length} événement${events.length > 1 ? 's' : ''}.`,
          );
        },
        error: (error: unknown) => {
          console.error('[Social] Fil d’activité indisponible', error);
          this.activityLoading.set(false);
          this.activityError.set(actionErrorMessage(error, 'Le fil d’activité est indisponible.'));
        },
      });
  }

  loadOverview(): void {
    this.error.set('');
    this.friendService
      .overview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (overview) => {
          this.friends.set(overview.friends);
          this.requests.set(overview.requests);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          console.error('[Social] Liste des amis indisponible', error);
          this.loading.set(false);
          this.error.set(actionErrorMessage(error, 'Impossible de charger vos amis.'));
        },
      });
  }

  relative(iso: string): string {
    return relativeTime(iso, this.now());
  }

  private confirmRemoveFriend(entry: FriendEntry): void {
    this.busyId.set(entry.friendshipId);
    this.friendService
      .remove(entry.friendshipId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set('');
          this.friends.update((list) => list.filter((f) => f.friendshipId !== entry.friendshipId));
          this.notify(`${entry.user.name} a été retiré de vos amis.`);
          this.loadActivity();
        },
        error: (error: unknown) => this.failAction(error, 'Le retrait a échoué.'),
      });
  }

  private removeRequest(request: FriendRequest, success: string, failure: string): void {
    if (this.busyId()) return;
    this.busyId.set(request.id);
    this.friendService
      .remove(request.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set('');
          this.dropRequest(request.id);
          this.notify(success);
        },
        error: (error: unknown) => this.failAction(error, failure),
      });
  }

  private dropRequest(id: string): void {
    this.requests.update((list) => list.filter((r) => r.id !== id));
  }

  private failAction(error: unknown, fallback: string): void {
    console.error('[Social] Action sur une amitié refusée', error);
    this.busyId.set('');
    this.notify(actionErrorMessage(error, fallback));
  }

  private notify(message: string): void {
    this.announcement.set(message);
    this.snackBar.open(message, 'Fermer', { duration: SNACK_DURATION_MS });
  }
}
