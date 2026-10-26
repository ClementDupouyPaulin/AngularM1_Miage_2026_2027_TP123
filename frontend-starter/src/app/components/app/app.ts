import { Component, computed, DOCUMENT, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';

export type ThemeChoice = 'auto' | 'dark' | 'light';

/** Clé partagée avec le script de `index.html` qui applique le thème avant le démarrage. */
export const THEME_STORAGE_KEY = 'film-pulse-theme';

const THEME_ORDER: readonly ThemeChoice[] = ['auto', 'dark', 'light'];
const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: 'automatique',
  dark: 'sombre',
  light: 'clair',
};
const MAX_INITIALS = 2;

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly auth = inject(AuthService);

  readonly menuOpen = signal(false);
  readonly theme = signal<ThemeChoice>(this.readStoredTheme());
  readonly themeLabel = computed(
    () => `Thème ${THEME_LABELS[this.theme()]} : passer au thème ${THEME_LABELS[this.nextTheme()]}`,
  );
  readonly initials = computed(() => {
    const words = this.auth.currentUser()?.name.trim().split(/\s+/).filter(Boolean) ?? [];
    return words.slice(0, MAX_INITIALS).map((word) => word[0].toUpperCase()).join('') || '?';
  });

  constructor() {
    this.applyTheme(this.theme());
    this.restoreProfileAfterReload();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** Fait tourner auto → sombre → clair, applique et mémorise le choix. */
  cycleTheme(): void {
    const next = this.nextTheme();
    this.theme.set(next);
    this.applyTheme(next);
    this.storeTheme(next);
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

  private nextTheme(): ThemeChoice {
    return THEME_ORDER[(THEME_ORDER.indexOf(this.theme()) + 1) % THEME_ORDER.length];
  }

  /** « auto » retire l'attribut : `prefers-color-scheme` reprend la main. */
  private applyTheme(choice: ThemeChoice): void {
    const root = this.document.documentElement;
    if (choice === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', choice);
    }
  }

  /** Le stockage peut être indisponible (navigation privée, quota) : le thème reste alors en mémoire. */
  private readStoredTheme(): ThemeChoice {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      return stored === 'dark' || stored === 'light' ? stored : 'auto';
    } catch (error: unknown) {
      console.warn('[App] Lecture du thème impossible', error);
      return 'auto';
    }
  }

  private storeTheme(choice: ThemeChoice): void {
    try {
      if (choice === 'auto') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, choice);
      }
    } catch (error: unknown) {
      console.warn('[App] Enregistrement du thème impossible', error);
    }
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
