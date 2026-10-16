import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

/**
 * Mission 7 du TP3 : « le guard redirige un utilisateur sans token ».
 * Le guard est une CanActivateFn : il doit être appelé dans un contexte
 * d'injection, d'où TestBed.runInInjectionContext.
 *
 * Rappel (restitution orale) : ce guard ne sécurise rien côté données, il ne
 * fait qu'éviter d'afficher une page vide. C'est le backend qui vérifie le JWT.
 */
describe('authGuard', () => {
  function run(token: string | null) {
    const fakeAuth = { token: signal(token) };

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: fakeAuth }],
    });

    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    return { result, router };
  }

  it('redirige vers /login (UrlTree) un utilisateur sans token', () => {
    const { result, router } = run(null);

    expect(result).toBeInstanceOf(UrlTree);
    // On vérifie la destination réelle, pas seulement « ce n'est pas true ».
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('laisse passer un utilisateur porteur d’un token', () => {
    const { result } = run('jwt-de-test');

    expect(result).toBe(true);
  });

  it('refuse aussi un token vide (chaîne vide = pas de session)', () => {
    const { result, router } = run('');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });
});
