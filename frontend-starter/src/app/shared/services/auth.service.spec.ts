import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { AuthResponse } from '../models/auth-response.model';
import { User } from '../models/user.model';

/**
 * Mission 7 du TP3 : « AuthService.login() utilise POST /api/auth/login avec
 * le bon corps ». On vérifie le contrat HTTP (méthode, URL, corps exact) et
 * l'effet de bord observable (token stocké, utilisateur courant exposé).
 *
 * Aucune assertion n'affiche la valeur du token : on vérifie seulement qu'il
 * est bien celui renvoyé par l'API, jamais en le journalisant.
 */
describe('AuthService', () => {
  const fakeUser: User = {
    id: 'u1',
    name: 'Demo User',
    email: 'demo@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  function setup() {
    // Le signal `token` est initialisé depuis localStorage à la construction
    // du service : on repart d'un stockage propre pour chaque test.
    localStorage.removeItem('gpc_token');

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    return {
      auth: TestBed.inject(AuthService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    localStorage.removeItem('gpc_token');
  });

  describe('login()', () => {
    it('envoie un POST sur /api/auth/login avec exactement { email, password }', () => {
      const { auth, httpMock } = setup();

      auth.login('demo@example.com', 'Demo1234!').subscribe();

      const request = httpMock.expectOne('/api/auth/login');
      expect(request.request.method).toBe('POST');
      // Corps exact : ni champ manquant, ni champ superflu (ex. `name`).
      expect(request.request.body).toEqual({
        email: 'demo@example.com',
        password: 'Demo1234!',
      });
      expect(Object.keys(request.request.body as object).sort()).toEqual(['email', 'password']);

      request.flush({ token: 'jwt-de-test', user: fakeUser } satisfies AuthResponse);
    });

    it('stocke le token renvoyé et publie l’utilisateur courant', () => {
      const { auth, httpMock } = setup();
      expect(auth.token()).toBeNull();

      auth.login('demo@example.com', 'Demo1234!').subscribe();
      httpMock
        .expectOne('/api/auth/login')
        .flush({ token: 'jwt-de-test', user: fakeUser } satisfies AuthResponse);

      // On compare au token simulé sans jamais l'afficher.
      expect(auth.token()).toBe('jwt-de-test');
      expect(localStorage.getItem('gpc_token')).toBe('jwt-de-test');
      expect(auth.currentUser()).toEqual(fakeUser);
    });

    it('ne stocke aucun token quand l’API rejette les identifiants (401)', () => {
      const { auth, httpMock } = setup();
      let caughtStatus = 0;

      auth
        .login('demo@example.com', 'mauvais-mot-de-passe')
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne('/api/auth/login')
        .flush({ message: 'invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      expect(caughtStatus).toBe(401);
      expect(auth.token()).toBeNull();
      expect(localStorage.getItem('gpc_token')).toBeNull();
      expect(auth.currentUser()).toBeNull();
    });
  });

  describe('register()', () => {
    it('envoie un POST sur /api/auth/register avec { name, email, password }', () => {
      const { auth, httpMock } = setup();

      auth.register('Demo User', 'demo@example.com', 'Demo1234!').subscribe();

      const request = httpMock.expectOne('/api/auth/register');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Demo User',
        email: 'demo@example.com',
        password: 'Demo1234!',
      });

      request.flush({ token: 'jwt-de-test', user: fakeUser } satisfies AuthResponse, {
        status: 201,
        statusText: 'Created',
      });
      expect(auth.token()).toBe('jwt-de-test');
    });
  });

  describe('profile() / update()', () => {
    it('lit le profil via GET /api/users/me et le publie dans currentUser', () => {
      const { auth, httpMock } = setup();

      auth.profile().subscribe();

      const request = httpMock.expectOne('/api/users/me');
      expect(request.request.method).toBe('GET');
      request.flush(fakeUser);

      expect(auth.currentUser()).toEqual(fakeUser);
    });

    it('met à jour le profil via PUT /api/users/me avec { name } seul', () => {
      const { auth, httpMock } = setup();

      auth.update('Nouveau Nom').subscribe();

      const request = httpMock.expectOne('/api/users/me');
      expect(request.request.method).toBe('PUT');
      // Le contrat n'accepte que `name` : envoyer l'email ou l'id serait un écart.
      expect(request.request.body).toEqual({ name: 'Nouveau Nom' });

      request.flush({ ...fakeUser, name: 'Nouveau Nom' });
      expect(auth.currentUser()?.name).toBe('Nouveau Nom');
    });
  });

  /**
   * `messageFromError()` est le point de passage unique des messages d'erreur
   * d'authentification affichés par `login-page`, `register-page` et
   * `profile-page`. Une régression ici dégraderait les trois écrans à la fois,
   * et aucun test ne le couvrait : d'où ces cas ciblés sur ses branches.
   */
  describe('messageFromError()', () => {
    it('réutilise le message renvoyé par le backend', () => {
      const { auth } = setup();
      const error = new HttpErrorResponse({
        status: 401,
        statusText: 'Unauthorized',
        error: { message: 'Identifiants invalides' },
      });

      expect(auth.messageFromError(error, 'repli')).toBe('Identifiants invalides');
    });

    it('signale un serveur injoignable (status 0) plutôt que le repli générique', () => {
      const { auth } = setup();
      const error = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error', error: null });

      expect(auth.messageFromError(error, 'repli')).toContain('Serveur injoignable');
    });

    it('retombe sur le repli quand le corps n’a pas de message exploitable', () => {
      const { auth } = setup();
      const sansMessage = new HttpErrorResponse({ status: 500, error: {} });
      const messageVide = new HttpErrorResponse({ status: 500, error: { message: '' } });
      const messageNonTexte = new HttpErrorResponse({ status: 500, error: { message: 42 } });
      // Corps binaire : cas réel d'un appel `responseType: 'blob'`.
      const corpsBlob = new HttpErrorResponse({ status: 404, error: new Blob(['{}']) });

      expect(auth.messageFromError(sansMessage, 'repli')).toBe('repli');
      expect(auth.messageFromError(messageVide, 'repli')).toBe('repli');
      expect(auth.messageFromError(messageNonTexte, 'repli')).toBe('repli');
      expect(auth.messageFromError(corpsBlob, 'repli')).toBe('repli');
    });

    it('retombe sur le repli pour une erreur qui n’est pas HTTP', () => {
      const { auth } = setup();

      expect(auth.messageFromError(new Error('boom'), 'repli')).toBe('repli');
      expect(auth.messageFromError(undefined, 'repli')).toBe('repli');
    });
  });

  describe('logout()', () => {
    it('vide le token du stockage et les signaux, sans appel HTTP', () => {
      const { auth, httpMock } = setup();

      auth.login('demo@example.com', 'Demo1234!').subscribe();
      httpMock
        .expectOne('/api/auth/login')
        .flush({ token: 'jwt-de-test', user: fakeUser } satisfies AuthResponse);

      auth.logout();

      expect(auth.token()).toBeNull();
      expect(auth.currentUser()).toBeNull();
      expect(localStorage.getItem('gpc_token')).toBeNull();
      // `verify()` dans afterEach garantit qu'aucune requête de logout n'a été émise.
    });
  });
});
