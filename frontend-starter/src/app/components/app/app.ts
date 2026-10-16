import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  constructor() {
    this.restoreProfileAfterReload();
  }

  /** Nettoie l'état local (token + profil) puis renvoie vers la connexion. */
  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  /**
   * Déplace le focus sur le contenu sans laisser le navigateur suivre le `href` :
   * on évite ainsi d'ajouter `#contenu` à l'URL (donc à l'historique) et de faire
   * réagir le routeur à un simple saut d'ancre.
   */
  skipToContent(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }

  /**
   * Après un F5, le token est relu depuis le stockage mais pas le profil : on le
   * recharge une fois pour l'en-tête. Un échec reste silencieux côté UI (le 401
   * est déjà traité par l'intercepteur : déconnexion + redirection).
   */
  private restoreProfileAfterReload(): void {
    if (!this.auth.token() || this.auth.currentUser()) {
      return;
    }

    this.auth
      .profile()
      .pipe(takeUntilDestroyed())
      .subscribe({
        error: (error: unknown) => console.error('[App] Chargement du profil impossible', error),
      });
  }
}
