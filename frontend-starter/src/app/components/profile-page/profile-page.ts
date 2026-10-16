import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { trimmedMinLength } from '../../shared/validators/trimmed-min-length.validator';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePageComponent implements OnInit {
  readonly auth = inject(AuthService);

  readonly error = signal('');
  readonly confirmation = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedMinLength],
    }),
  });

  private readonly nameValue = toSignal(this.form.controls.name.valueChanges, {
    initialValue: this.form.controls.name.value,
  });

  /** Enregistrement utile seulement si le nom est valide et différent de l'actuel. */
  readonly canSave = computed(
    () => this.nameValue() !== this.auth.currentUser()?.name && this.form.controls.name.valid,
  );

  readonly initials = computed(() => {
    const words = (this.auth.currentUser()?.name ?? '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';
  });

  readonly memberSince = computed(() => {
    const createdAt = this.auth.currentUser()?.createdAt ?? '';
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime())
      ? createdAt.slice(0, 10)
      : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.confirmation.set('');
    this.loading.set(true);

    this.auth.profile().subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil chargé', user.id);
        this.loading.set(false);
        this.form.setValue({ name: user.name });
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Chargement impossible', error);
        this.loading.set(false);
        this.error.set(
          this.auth.messageFromError(error, 'Impossible de charger votre profil pour le moment.'),
        );
      },
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.error.set('');
    this.confirmation.set('');
    this.saving.set(true);

    this.auth.update(this.form.getRawValue().name).subscribe({
      next: (user) => {
        // Le Signal `currentUser` est mis à jour par AuthService.update() :
        // l'affichage ci-dessus reflète donc immédiatement le nouveau nom.
        console.debug('[ProfilePage] Profil enregistré', user.id);
        this.saving.set(false);
        this.confirmation.set('Votre nom a bien été mis à jour.');
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Enregistrement impossible', error);
        this.saving.set(false);
        this.error.set(
          this.auth.messageFromError(error, 'Impossible d’enregistrer votre nom pour le moment.'),
        );
      },
    });
  }
}
