import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { AppComponent } from './app';
import { AuthService } from '../../shared/services/auth.service';
import { User } from '../../shared/models/user.model';

/**
 * Problème 1 (voir docs/mission1/probleme-1-deconnexion.md) : aucun moyen de
 * se déconnecter depuis l'interface. Ces tests décrivent le comportement
 * attendu et échouent tant que le bouton de déconnexion n'existe pas.
 */
const DEMO_USER: User = {
  id: 'u1',
  name: 'Demo User',
  email: 'demo@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('AppComponent', () => {
  function setup(
    token: string | null,
    user: User | null = null,
    routes: Routes = [],
    profile$: Observable<User> = of(DEMO_USER),
  ) {
    const fakeAuth = {
      token: signal(token),
      currentUser: signal<User | null>(user),
      logout: vi.fn(),
      profile: vi.fn(() => profile$),
    };

    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter(routes), { provide: AuthService, useValue: fakeAuth }],
    });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    if (routes.length === 0) {
      vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    }

    return { fixture, fakeAuth, router };
  }

  it('se crée', () => {
    const { fixture } = setup(null);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("n'affiche pas de bouton de déconnexion quand l'utilisateur n'est pas authentifié", () => {
    const { fixture } = setup(null);
    const button = fixture.nativeElement.querySelector('[data-testid="logout-button"]');
    expect(button).toBeNull();
  });

  it('affiche un bouton de déconnexion quand l’utilisateur est authentifié', () => {
    const { fixture } = setup('fake-jwt-token');
    const button = fixture.nativeElement.querySelector('[data-testid="logout-button"]');
    expect(button).toBeTruthy();
  });

  it('appelle AuthService.logout() et redirige vers /login au clic sur le bouton', () => {
    const { fixture, fakeAuth, router } = setup('fake-jwt-token');
    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[data-testid="logout-button"]',
    );

    button?.click();

    expect(fakeAuth.logout).toHaveBeenCalledOnce();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it("expose un lien d'évitement qui déplace le focus vers <main id=\"contenu\">", () => {
    const { fixture } = setup('fake-jwt-token');
    const root: HTMLElement = fixture.nativeElement;
    const skip: HTMLAnchorElement = root.querySelector('a.skip-link')!;
    const main: HTMLElement = root.querySelector('main#contenu')!;

    expect(skip.getAttribute('href')).toBe('#contenu');
    expect(main.getAttribute('tabindex')).toBe('-1');

    skip.click();

    expect(document.activeElement).toBe(main);
  });

  it('marque le lien de la page courante avec aria-current="page"', async () => {
    const { fixture, router } = setup('fake-jwt-token', null, [
      { path: 'tracks', children: [] },
      { path: 'profile', children: [] },
    ]);
    await router.navigateByUrl('/profile');
    await fixture.whenStable();
    fixture.detectChanges();

    const current: HTMLAnchorElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('nav a[aria-current="page"]'),
    );
    expect(current.map((link) => link.getAttribute('href'))).toEqual(['/profile']);
  });

  it("affiche les liens de connexion/inscription et aucun lien privé hors session", () => {
    const { fixture } = setup(null);
    const hrefs = Array.from<HTMLAnchorElement>(
      fixture.nativeElement.querySelectorAll('nav a'),
    ).map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual(['/login', '/register']);
  });

  it("affiche le nom de l'utilisateur connecté dans l'en-tête", () => {
    const { fixture } = setup('fake-jwt-token', {
      id: 'u1',
      name: 'Demo User',
      email: 'demo@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const name: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-testid="header-user-name"]',
    );

    expect(name?.textContent).toContain('Demo User');
  });

  describe('restauration du profil après un rafraîchissement', () => {
    it('charge le profil une fois quand le token est présent sans utilisateur', () => {
      const { fakeAuth } = setup('fake-jwt-token');
      expect(fakeAuth.profile).toHaveBeenCalledOnce();
    });

    it("ne charge rien quand l'utilisateur est déconnecté", () => {
      const { fakeAuth } = setup(null);
      expect(fakeAuth.profile).not.toHaveBeenCalled();
    });

    it("ne charge rien quand l'utilisateur est déjà renseigné", () => {
      const { fakeAuth } = setup('fake-jwt-token', DEMO_USER);
      expect(fakeAuth.profile).not.toHaveBeenCalled();
    });

    it.each([
      ['401', new HttpErrorResponse({ status: 401 })],
      ['réseau', new HttpErrorResponse({ status: 0 })],
    ])("n'affiche pas d'erreur et ne plante pas sur un échec %s", (_label, failure) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { fixture } = setup('fake-jwt-token', null, [], throwError(() => failure));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="logout-button"]')).toBeTruthy();
      expect(consoleError).toHaveBeenCalledOnce();
      consoleError.mockRestore();
    });
  });
});
