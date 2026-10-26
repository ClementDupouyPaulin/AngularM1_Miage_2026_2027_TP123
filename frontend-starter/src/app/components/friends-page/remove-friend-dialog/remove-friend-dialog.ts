import { Component, ViewEncapsulation, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export const REMOVE_FRIEND_PANEL_CLASS = 'friend-confirm-dialog';

export interface RemoveFriendDialogData {
  name: string;
}

/** Confirmation du retrait d'un ami : ferme avec `true` uniquement sur « Retirer ». */
@Component({
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose],
  templateUrl: './remove-friend-dialog.html',
  styleUrl: './remove-friend-dialog.css',
  encapsulation: ViewEncapsulation.None,
})
export class RemoveFriendDialogComponent {
  readonly data = inject<RemoveFriendDialogData>(MAT_DIALOG_DATA);
}
