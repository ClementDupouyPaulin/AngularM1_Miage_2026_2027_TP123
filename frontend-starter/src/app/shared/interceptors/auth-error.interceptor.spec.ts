import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authErrorInterceptor } from './auth-error.interceptor';
import { AuthService } from '../services/auth.service';

/**
 * Problème 3 (voir docs/mission1/probleme-3-gestion-401.md). Contrairement
 * aux autres problèmes, ce test est écrit en même temps que l'implémentation
 * (l'unité n'existait pas avant).
 */
describe('authErrorInterceptor', () => {
  function setup() {
    const fakeAuth = { logout: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authErrorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: fakeAuth },
      ],
    });

    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    return { http, httpMock, fakeAuth, router };
  }

  it('déconnecte et redirige vers /login sur une réponse 401', () => {
    const { http, httpMock, fakeAuth, router } = setup();
    let caughtError: unknown;

    http.get('/api/users/me').subscribe({ error: (error) => (caughtError = error) });
    httpMock
      .expectOne('/api/users/me')
      .flush({ message: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(fakeAuth.logout).toHaveBeenCalledOnce();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    expect(caughtError).toBeTruthy();
  });

  it('ne déclenche pas de déconnexion sur une autre erreur (404)', () => {
    const { http, httpMock, fakeAuth, router } = setup();

    http.get('/api/tracks/unknown-id').subscribe({ error: () => {} });
    httpMock
      .expectOne('/api/tracks/unknown-id')
      .flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });

    expect(fakeAuth.logout).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('ne déclenche pas de déconnexion sur une réponse réussie', () => {
    const { http, httpMock, fakeAuth } = setup();

    http.get('/api/tracks').subscribe();
    httpMock.expectOne('/api/tracks').flush({ items: [] });

    expect(fakeAuth.logout).not.toHaveBeenCalled();
  });

  /**
   * Routes publiques du contrat : un 401 y signifie « identifiants refusés », pas
   * « session expirée ». Déconnecter et naviguer vers /login effacerait le
   * message d'erreur du formulaire. Ces tests verrouillent le filtrage
   * (`PUBLIC_AUTH_ROUTES`) : un refactor qui le supprimerait redeviendrait
   * visible immédiatement.
   */
  describe('routes publiques d’authentification', () => {
    it('ne déconnecte pas et ne redirige pas sur un 401 de POST /api/auth/login', () => {
      const { http, httpMock, fakeAuth, router } = setup();
      let caughtStatus = 0;

      http
        .post('/api/auth/login', { email: 'demo@example.com', password: 'mauvais' })
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne('/api/auth/login')
        .flush({ message: 'invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      expect(fakeAuth.logout).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      // L'erreur doit rester propagée : c'est elle qui alimente le message du formulaire.
      expect(caughtStatus).toBe(401);
    });

    it('ne déconnecte pas et ne redirige pas sur un 401 de POST /api/auth/register', () => {
      const { http, httpMock, fakeAuth, router } = setup();
      let caughtStatus = 0;

      http
        .post('/api/auth/register', { name: 'Demo', email: 'demo@example.com', password: 'court' })
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne('/api/auth/register')
        .flush({ message: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      expect(fakeAuth.logout).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(caughtStatus).toBe(401);
    });

    it('déconnecte toujours sur un 401 d’une route protégée (GET /api/users/me)', () => {
      const { http, httpMock, fakeAuth, router } = setup();
      let caughtStatus = 0;

      http
        .get('/api/users/me')
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne('/api/users/me')
        .flush({ message: 'invalid token' }, { status: 401, statusText: 'Unauthorized' });

      // Le filtrage des routes publiques ne doit pas avoir désactivé le cas d'origine.
      expect(fakeAuth.logout).toHaveBeenCalledOnce();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
      expect(caughtStatus).toBe(401);
    });

    it('déconnecte sur un 401 de route protégée dont l’URL contient une query string', () => {
      const { http, httpMock, fakeAuth, router } = setup();

      http.get('/api/tracks', { params: { page: 1, limit: 5 } }).subscribe({ error: () => {} });
      httpMock
        .expectOne((candidate) => candidate.urlWithParams === '/api/tracks?page=1&limit=5')
        .flush({ message: 'invalid token' }, { status: 401, statusText: 'Unauthorized' });

      expect(fakeAuth.logout).toHaveBeenCalledOnce();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    });
  });
});
