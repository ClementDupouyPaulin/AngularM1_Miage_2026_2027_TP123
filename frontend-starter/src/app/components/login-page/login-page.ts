import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly form = new FormGroup({
    email: new FormControl('demo@example.com', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    // Jamais de mot de passe en dur dans le code frontend (voir AGENTS.md) :
    // celui du compte de démonstration est documenté dans SUJET_ETUDIANT_TP1.md.
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
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

    this.auth.login(values.email, values.password).subscribe({
      next: () => {
        // Aucun token n'est loggué : seule la réussite de l'étape est tracée.
        console.debug('[LoginPage] Connexion réussie');
        this.submitting.set(false);
        void this.router.navigateByUrl('/tracks');
      },
      error: (error: unknown) => {
        console.error('[LoginPage] Échec de connexion', error);
        this.submitting.set(false);
        this.error.set(
          this.auth.messageFromError(error, 'Connexion impossible. Vérifiez vos identifiants.'),
        );
      },
    });
  }
}
