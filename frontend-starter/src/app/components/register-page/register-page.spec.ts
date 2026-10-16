import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RegisterPageComponent } from './register-page';

function setup() {
  TestBed.configureTestingModule({
    imports: [RegisterPageComponent],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(RegisterPageComponent);
  fixture.detectChanges();
  return fixture;
}

/**
 * Problème 4 (voir docs/mission1/probleme-4-validation-formulaires.md) : le
 * bouton d'inscription reste actif même à l'état initial (champs vides).
 */
describe('RegisterPageComponent - validation du formulaire (Problème 4)', () => {
  it("désactive le bouton d'inscription tant que le formulaire est invalide (champs vides)", () => {
    const fixture = setup();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
  });
});

/**
 * Problème 5 (voir docs/mission1/probleme-5-robustesse-mot-de-passe.md) :
 * aucune contrainte de longueur minimale sur le mot de passe.
 */
describe('RegisterPageComponent - robustesse du mot de passe (Problème 5)', () => {
  it('refuse un mot de passe de moins de 8 caractères (erreur minlength)', () => {
    const fixture = setup();
    const passwordControl = fixture.componentInstance.form.controls.password;

    passwordControl.setValue('abc123');

    expect(passwordControl.hasError('minlength')).toBe(true);
  });

  it('accepte un mot de passe de 8 caractères ou plus', () => {
    const fixture = setup();
    const passwordControl = fixture.componentInstance.form.controls.password;

    passwordControl.setValue('abcdefgh');

    expect(passwordControl.hasError('minlength')).toBe(false);
  });
});

describe('RegisterPageComponent - accessibilité et affichage du mot de passe', () => {
  it('masque le mot de passe par défaut puis le révèle via le bouton (aria-pressed)', () => {
    const fixture = setup();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#register-password');
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="toggle-password"]',
    );
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    fixture.detectChanges();

    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it("garde l'aide de saisie liée au mot de passe et y ajoute l'erreur quand elle apparaît", () => {
    const fixture = setup();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#register-password');
    expect(input.getAttribute('aria-describedby')).toBe('register-password-hint');

    fixture.componentInstance.form.controls.password.setValue('abc');
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="password-error"]');
    expect(input.getAttribute('aria-describedby')).toBe(`register-password-hint ${error.id}`);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('relie les erreurs du nom et de l’email à leur champ via aria-describedby', () => {
    const fixture = setup();
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    for (const [inputId, errorTestId] of [
      ['register-name', 'name-error'],
      ['register-email', 'email-error'],
    ]) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(`#${inputId}`);
      const error = fixture.nativeElement.querySelector(`[data-testid="${errorTestId}"]`);
      expect(input.getAttribute('aria-describedby')).toBe(error.id);
    }
  });
});


describe('RegisterPageComponent - nom (2 caractères minimum après trim)', () => {
  it.each([['a'], ['  a  ']])('refuse le nom « %s » avec un message relié au champ', (name) => {
    const fixture = setup();
    fixture.componentInstance.form.controls.name.setValue(name);
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('#register-name');
    const error = fixture.nativeElement.querySelector('[data-testid="name-error"]');
    expect(fixture.componentInstance.form.controls.name.invalid).toBe(true);
    expect(error.textContent).toContain('au moins 2 caractères');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('accepte un nom de 2 caractères', () => {
    const fixture = setup();
    fixture.componentInstance.form.controls.name.setValue('Al');
    expect(fixture.componentInstance.form.controls.name.valid).toBe(true);
  });
});
