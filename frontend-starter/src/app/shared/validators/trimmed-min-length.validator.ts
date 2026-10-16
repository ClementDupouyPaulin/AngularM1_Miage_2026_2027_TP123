import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Le backend exige au moins 2 caractères après suppression des espaces (User.js). */
export const NAME_MIN_LENGTH = 2;

/** Comme `Validators.minLength`, mais sur la valeur rognée : « a » entouré d'espaces est refusé. */
export function trimmedMinLength(control: AbstractControl): ValidationErrors | null {
  const length = String(control.value ?? '').trim().length;
  return length < NAME_MIN_LENGTH
    ? { minlength: { requiredLength: NAME_MIN_LENGTH, actualLength: length } }
    : null;
}
