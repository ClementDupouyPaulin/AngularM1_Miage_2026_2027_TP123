import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AuthResponse } from '../models/auth-response.model';
import { User } from '../models/user.model';

/** Clé de persistance du JWT dans le navigateur. */
const TOKEN_KEY = 'gpc_token';

/** Handles authentication and the current user's profile. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly currentUser = signal<User | null>(null);
  readonly token = signal<string | null>(AuthService.readStoredToken());

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  register(name: string, email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/register', { name, email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  profile(): Observable<User> {
    return this.http.get<User>('/api/users/me').pipe(tap((user) => this.currentUser.set(user)));
  }

  update(name: string): Observable<User> {
    return this.http
      .put<User>('/api/users/me', { name })
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  /** Efface l'intégralité de l'état d'authentification local. */
  logout(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Stockage indisponible (navigation privée, environnement de test) :
      // les Signals ci-dessous restent la source de vérité en mémoire.
    }
    this.token.set(null);
    this.currentUser.set(null);
  }

  /**
   * Traduit une erreur HTTP en message affichable en français. Le backend
   * renvoie déjà `{ message }` en français (voir `API_CONTRACT.md`) : on le
   * réutilise, sinon on retombe sur un libellé lisible plutôt qu'un objet brut.
   */
  messageFromError(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    if (error.status === 0) {
      return 'Serveur injoignable. Vérifiez votre connexion puis réessayez.';
    }

    const body: unknown = error.error;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
    }

    return fallback;
  }

  private storeAuthentication(response: AuthResponse): void {
    try {
      localStorage.setItem(TOKEN_KEY, response.token);
    } catch {
      // Le token reste utilisable pour la session en cours via le Signal,
      // il ne survivra simplement pas à un rafraîchissement de la page.
    }
    this.token.set(response.token);
    this.currentUser.set(response.user);
  }

  private static readStoredToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
}
