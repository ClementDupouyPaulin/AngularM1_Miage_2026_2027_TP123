import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LoginPageComponent } from './login-page';

/**
 * Problème 4 (voir docs/mission1/probleme-4-validation-formulaires.md) : le
 * bouton de connexion reste actif même si le formulaire est invalide. Ce
 * test échoue tant que `[disabled]="form.invalid"` n'est pas branché dans
 * login-page.html.
 */
describe('LoginPageComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  function submitButton(fixture: ComponentFixture<LoginPageComponent>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[type="submit"]');
  }

  it('désactive le bouton de connexion si le formulaire est invalide', () => {
    const fixture = setup();
    fixture.componentInstance.form.controls.email.setValue('');
    fixture.detectChanges();

    expect(submitButton(fixture).disabled).toBe(true);
  });

  /**
   * Nouvel état initial : le mot de passe ne peut plus être pré-rempli en dur
   * dans le code (donnée sensible), il démarre donc vide et le formulaire est
   * invalide à l'arrivée sur la page. Ce test verrouille ce comportement.
   */
  it('désactive le bouton de connexion à l’état initial (mot de passe vide)', () => {
    const fixture = setup();

    expect(fixture.componentInstance.form.controls.password.value).toBe('');
    expect(fixture.componentInstance.form.controls.password.hasError('required')).toBe(true);
    expect(submitButton(fixture).disabled).toBe(true);
  });

  it('laisse le bouton de connexion actif quand email et mot de passe sont saisis', () => {
    const fixture = setup();
    // Le mot de passe doit désormais être saisi explicitement : le formulaire
    // n'est plus valide dès l'initialisation.
    fixture.componentInstance.form.controls.password.setValue('MotDePasseTest123');
    fixture.detectChanges();

    expect(fixture.componentInstance.form.valid).toBe(true);
    expect(submitButton(fixture).disabled).toBe(false);
  });

  /**
   * Chemin d'erreur le plus emprunté de l'application (mot de passe refusé), et
   * le seul qui traverse toute la chaîne : échec HTTP → `messageFromError()` →
   * DOM. Exigence mission 7 : « le composant affiche une erreur après un échec
   * HTTP ». Aucun test ne le couvrait de bout en bout.
   */
  it('affiche le message du backend après un échec de connexion, sans naviguer', () => {
    const fixture = setup();
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.form.controls.password.setValue('MotDePasseTest123');
    fixture.detectChanges();
    submitButton(fixture).click();

    // Le formulaire signale l'envoi en cours et se verrouille.
    expect(fixture.componentInstance.submitting()).toBe(true);

    const request = httpMock.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    request.flush(
      { message: 'Identifiants invalides' },
      { status: 401, statusText: 'Unauthorized' },
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.submitting()).toBe(false);
    // Message annoncé aux lecteurs d'écran, et pas seulement stocké dans un signal.
    const alert: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-testid="login-error"]',
    );
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Identifiants invalides');
    // L'utilisateur reste sur le formulaire : aucune redirection sur échec.
    expect(navigateSpy).not.toHaveBeenCalled();
    // Le mot de passe saisi ne doit jamais ressortir dans l'interface.
    expect(fixture.nativeElement.textContent).not.toContain('MotDePasseTest123');

    httpMock.verify();
  });

  it('redirige vers /tracks après une connexion réussie', () => {
    const fixture = setup();
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.form.controls.password.setValue('MotDePasseTest123');
    fixture.detectChanges();
    submitButton(fixture).click();

    httpMock.expectOne('/api/auth/login').flush({
      token: 'jwt-de-test',
      user: {
        id: 'u1',
        name: 'Demo User',
        email: 'demo@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(navigateSpy).toHaveBeenCalledWith('/tracks');
    expect(fixture.componentInstance.error()).toBe('');
    httpMock.verify();
  });

  describe('accessibilité et affichage du mot de passe', () => {
    function passwordInput(fixture: ComponentFixture<LoginPageComponent>): HTMLInputElement {
      return fixture.nativeElement.querySelector('#login-password');
    }
    function toggle(fixture: ComponentFixture<LoginPageComponent>): HTMLButtonElement {
      return fixture.nativeElement.querySelector('[data-testid="toggle-password"]');
    }

    it('masque le mot de passe par défaut puis le révèle via le bouton (aria-pressed)', () => {
      const fixture = setup();
      expect(passwordInput(fixture).type).toBe('password');
      expect(toggle(fixture).getAttribute('aria-pressed')).toBe('false');

      toggle(fixture).click();
      fixture.detectChanges();
      expect(passwordInput(fixture).type).toBe('text');
      expect(toggle(fixture).getAttribute('aria-pressed')).toBe('true');

      toggle(fixture).click();
      fixture.detectChanges();
      expect(passwordInput(fixture).type).toBe('password');
    });

    it("relie l'erreur de chaque champ à son input via aria-describedby", () => {
      const fixture = setup();
      const email: HTMLInputElement = fixture.nativeElement.querySelector('#login-email');
      expect(email.hasAttribute('aria-describedby')).toBe(false);

      fixture.componentInstance.form.controls.email.setValue('pas-un-email');
      fixture.componentInstance.form.markAllAsTouched();
      fixture.detectChanges();

      const emailError = fixture.nativeElement.querySelector('[data-testid="email-error"]');
      expect(email.getAttribute('aria-describedby')).toBe(emailError.id);
      expect(email.getAttribute('aria-invalid')).toBe('true');

      const describedBy = passwordInput(fixture).getAttribute('aria-describedby') ?? '';
      const passwordError = fixture.nativeElement.querySelector('[data-testid="password-error"]');
      expect(describedBy.split(' ')).toContain(passwordError.id);
    });

    it('affiche un indicateur de chargement sur le bouton pendant la connexion', () => {
      const fixture = setup();
      const httpMock = TestBed.inject(HttpTestingController);
      fixture.componentInstance.form.controls.password.setValue('MotDePasseTest123');
      fixture.detectChanges();
      submitButton(fixture).click();
      fixture.detectChanges();

      expect(submitButton(fixture).querySelector('.spinner')).toBeTruthy();
      expect(submitButton(fixture).textContent).toContain('Connexion en cours');
      httpMock.expectOne('/api/auth/login');
    });
  });
});
