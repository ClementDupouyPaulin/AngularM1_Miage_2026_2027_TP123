import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { trimmedMinLength } from '../../shared/validators/trimmed-min-length.validator';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
})
export class RegisterPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  readonly submitting = signal(false);
  readonly showPassword = signal(false);

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedMinLength],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const values = this.form.getRawValue();
    this.error.set('');
    this.submitting.set(true);

    this.auth.register(values.name, values.email, values.password).subscribe({
      next: () => {
        // Aucun mot de passe ni token n'est loggué.
        console.debug('[RegisterPage] Inscription réussie');
        this.submitting.set(false);
        void this.router.navigateByUrl('/profile');
      },
      error: (error: unknown) => {
        console.error('[RegisterPage] Échec de l’inscription', error);
        this.submitting.set(false);
        this.error.set(
          this.auth.messageFromError(error, 'Inscription impossible. Vérifiez vos informations.'),
        );
      },
    });
  }
}
