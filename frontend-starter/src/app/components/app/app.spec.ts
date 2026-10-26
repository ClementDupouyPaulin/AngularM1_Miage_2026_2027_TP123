import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { AppComponent, THEME_STORAGE_KEY } from './app';
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

  it('affiche la navigation du studio en session', () => {
    const { fixture } = setup('fake-jwt-token', DEMO_USER);
    const links = Array.from<HTMLAnchorElement>(fixture.nativeElement.querySelectorAll('nav a'));

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/clips',
      '/discover',
      '/friends',
      '/tracks',
      '/profile',
    ]);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Studio',
      'Découvrir',
      'Amis',
      'Bandes-son',
      'Profil',
    ]);
  });

  it('ouvre et referme le menu replié avec aria-expanded', () => {
    const { fixture } = setup('fake-jwt-token', DEMO_USER);
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.menu-toggle');

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('nav.open')).toBeTruthy();
  });

  describe('sélecteur de thème', () => {
    afterEach(() => {
      localStorage.removeItem(THEME_STORAGE_KEY);
      document.documentElement.removeAttribute('data-theme');
    });

    function themeButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
      return fixture.nativeElement.querySelector('[data-testid="theme-toggle"]')!;
    }

    it('applique le thème mémorisé au démarrage', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
      setup(null);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('fait tourner auto → sombre → clair → auto et persiste le choix', () => {
      const { fixture } = setup(null);
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

      themeButton(fixture).click();
      fixture.detectChanges();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
      expect(themeButton(fixture).getAttribute('aria-label')).toContain('Thème sombre');

      themeButton(fixture).click();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      themeButton(fixture).click();
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('reste utilisable quand le stockage est indisponible', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const unavailable = () => {
        throw new Error('SecurityError');
      };
      vi.stubGlobal('localStorage', {
        getItem: unavailable,
        setItem: unavailable,
        removeItem: unavailable,
      });

      const { fixture } = setup(null);
      themeButton(fixture).click();

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(warn).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
      warn.mockRestore();
    });
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
