import { Component, ViewEncapsulation, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

/** Classe du panneau d'overlay, cible des styles (thème clair/sombre). */
export const CONFIRM_DELETE_PANEL_CLASS = 'track-confirm-dialog';

/**
 * Données transmises au dialogue : le titre de la piste et ce qui est supprimé
 * (la piste entière par défaut, ou seulement sa pochette).
 */
export interface ConfirmDeleteDialogData {
  title: string;
  target?: 'track' | 'cover' | 'clip';
}

/**
 * Confirmation de suppression. Ferme avec `true` uniquement sur « Supprimer » ;
 * Échap, clic hors du dialogue et « Annuler » ferment avec `undefined`/`false`.
 * `MatDialog` piège le focus et le restitue au bouton d'origine.
 */
@Component({
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose],
  templateUrl: './confirm-delete-dialog.html',
  styleUrl: './confirm-delete-dialog.css',
  encapsulation: ViewEncapsulation.None,
})
export class ConfirmDeleteDialogComponent {
  readonly data = inject<ConfirmDeleteDialogData>(MAT_DIALOG_DATA);
}
