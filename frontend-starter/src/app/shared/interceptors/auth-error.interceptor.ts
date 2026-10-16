import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Routes publiques du contrat HTTP (`API_CONTRACT.md`) : elles n'exigent pas de
 * JWT, donc un 401 y signifie « identifiants refusés », pas « session expirée ».
 * Il ne faut ni déconnecter ni rediriger dans ce cas, sinon la navigation
 * parasite vers /login efface le message d'erreur du formulaire.
 */
const PUBLIC_AUTH_ROUTES = ['/api/auth/login', '/api/auth/register'];

function isPublicAuthRoute(url: string): boolean {
  return PUBLIC_AUTH_ROUTES.some((route) => url.startsWith(route));
}

/** Déconnecte et redirige vers /login quand l'API rejette le token (401). */
export const authErrorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      const isSessionExpired =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !isPublicAuthRoute(request.url);

      if (isSessionExpired) {
        auth.logout();
        void router.navigateByUrl('/login');
      }

      // L'erreur est toujours propagée pour que le composant appelant puisse
      // afficher un message compréhensible à l'utilisateur.
      return throwError(() => error);
    }),
  );
};
