import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

/**
 * Mission 7 du TP3 : « l'intercepteur ajoute Authorization lorsqu'un token
 * existe ». Le cas symétrique (aucun header d'authentification quand il n'y a
 * pas de token) est au moins aussi important : un `Bearer null` envoyé sur
 * /api/auth/login provoquerait un 401 sur la connexion elle-même.
 *
 * On passe par un faux AuthService à signal pour piloter l'état du token sans
 * dépendre de localStorage.
 */
describe('authInterceptor', () => {
  function setup(token: string | null) {
    const fakeAuth = { token: signal(token) };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: fakeAuth },
      ],
    });

    return {
      http: TestBed.inject(HttpClient),
      httpMock: TestBed.inject(HttpTestingController),
      fakeAuth,
    };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('ajoute Authorization: Bearer <token> quand un token est présent', () => {
    const { http, httpMock } = setup('jwt-de-test');

    http.get('/api/tracks').subscribe();

    const request = httpMock.expectOne('/api/tracks');
    expect(request.request.headers.has('Authorization')).toBe(true);
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-de-test');

    request.flush({ items: [] });
  });

  it("n'ajoute aucun header d'authentification quand il n'y a pas de token", () => {
    const { http, httpMock } = setup(null);

    http.post('/api/auth/login', { email: 'demo@example.com', password: 'Demo1234!' }).subscribe();

    const request = httpMock.expectOne('/api/auth/login');
    // Ni header absent-mais-vide, ni « Bearer null ».
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.headers.get('Authorization')).toBeNull();

    request.flush({ token: 'jwt-de-test', user: {} });
  });

  it('relit le token à chaque requête (une connexion en cours de session est prise en compte)', () => {
    const { http, httpMock, fakeAuth } = setup(null);

    http.get('/api/tracks').subscribe();
    expect(httpMock.expectOne('/api/tracks').request.headers.has('Authorization')).toBe(false);
    httpMock.verify();

    fakeAuth.token.set('jwt-obtenu-apres-login');

    http.get('/api/tracks').subscribe();
    expect(httpMock.expectOne('/api/tracks').request.headers.get('Authorization')).toBe(
      'Bearer jwt-obtenu-apres-login',
    );
  });

  it('ne modifie ni la méthode, ni l’URL, ni le corps de la requête', () => {
    const { http, httpMock } = setup('jwt-de-test');
    const body = { name: 'Nouveau Nom' };

    http.put('/api/users/me', body).subscribe();

    const request = httpMock.expectOne('/api/users/me');
    expect(request.request.method).toBe('PUT');
    expect(request.request.url).toBe('/api/users/me');
    expect(request.request.body).toEqual(body);

    request.flush({ id: 'u1', name: 'Nouveau Nom' });
  });
});
