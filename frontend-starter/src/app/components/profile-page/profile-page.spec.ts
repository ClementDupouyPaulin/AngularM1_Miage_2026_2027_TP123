import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NEVER, Observable, of } from 'rxjs';
import { ProfilePageComponent } from './profile-page';
import { AuthService } from '../../shared/services/auth.service';
import { User } from '../../shared/models/user.model';

/**
 * Problème 2 (voir docs/mission1/probleme-2-chargement-auto-profil.md) : le
 * profil ne se charge pas tout seul à l'arrivée sur la page, il faut cliquer
 * sur "Charger mon profil". Ce test échoue tant que ProfilePageComponent
 * n'appelle pas AuthService.profile() automatiquement à l'initialisation.
 */
describe('ProfilePageComponent', () => {
  const fakeUser: User = {
    id: 'u1',
    name: 'Demo User',
    email: 'demo@example.com',
    createdAt: new Date().toISOString(),
  };

  it('charge automatiquement le profil au démarrage du composant', () => {
    const fakeAuth = {
      currentUser: signal<User | null>(null),
      profile: vi.fn(() => of(fakeUser)),
      update: vi.fn(() => of(fakeUser)),
    };

    TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [{ provide: AuthService, useValue: fakeAuth }],
    });

    const fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges(); // déclenche ngOnInit

    expect(fakeAuth.profile).toHaveBeenCalledOnce();
  });
});

describe('ProfilePageComponent - interface', () => {
  const user: User = {
    id: 'u1',
    name: 'Demo User',
    email: 'demo@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  function setup(initialUser: User | null, profile$: Observable<User> = of(user)) {
    const fakeAuth = {
      currentUser: signal<User | null>(initialUser),
      profile: vi.fn(() => profile$),
      update: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [{ provide: AuthService, useValue: fakeAuth }],
    });
    const fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    return { fixture, fakeAuth };
  }

  function saveButton(fixture: ComponentFixture<ProfilePageComponent>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[type="submit"]');
  }

  function typeName(fixture: ComponentFixture<ProfilePageComponent>, value: string): void {
    fixture.componentInstance.form.controls.name.setValue(value);
    fixture.detectChanges();
  }

  it("désactive « Enregistrer » tant que le nom n'a pas changé", () => {
    const { fixture } = setup(user);
    expect(saveButton(fixture).disabled).toBe(true);

    typeName(fixture, 'Nouveau Nom');
    expect(saveButton(fixture).disabled).toBe(false);

    typeName(fixture, 'Demo User');
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it('désactive « Enregistrer » quand le nom est vide', () => {
    const { fixture } = setup(user);
    typeName(fixture, '');
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it("affiche les initiales de l'utilisateur dans l'avatar", () => {
    const { fixture } = setup(user);
    const avatar: HTMLElement = fixture.nativeElement.querySelector('[data-testid="profile-avatar"]');
    expect(avatar.textContent?.trim()).toBe('DU');
  });

  it('affiche un squelette pendant le chargement initial, sans profil', () => {
    const { fixture } = setup(null, NEVER);
    expect(fixture.nativeElement.querySelector('[data-testid="profile-skeleton"] .skeleton')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="profile-name"]')).toBeNull();
  });

  it('confirme la sauvegarde puis redésactive le bouton', () => {
    const { fixture, fakeAuth } = setup(user);
    fakeAuth.update.mockImplementation((name: string) => {
      fakeAuth.currentUser.set({ ...user, name });
      return of({ ...user, name });
    });
    typeName(fixture, 'Nouveau Nom');

    saveButton(fixture).click();
    fixture.detectChanges();

    const confirmation = fixture.nativeElement.querySelector('[data-testid="profile-confirmation"]');
    expect(confirmation.getAttribute('role')).toBe('status');
    expect(saveButton(fixture).disabled).toBe(true);
  });

  it.each([['a'], ['  a  '], ['   ']])('refuse le nom « %s » (moins de 2 caractères après trim)', (name) => {
    const { fixture } = setup(user);
    typeName(fixture, name);
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('#profile-name-input');
    const error = fixture.nativeElement.querySelector('[data-testid="name-error"]');
    expect(saveButton(fixture).disabled).toBe(true);
    expect(error.textContent).toContain('au moins 2 caractères');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('accepte un nom de 2 caractères', () => {
    const { fixture } = setup(user);
    typeName(fixture, 'Al');
    expect(saveButton(fixture).disabled).toBe(false);
  });
});

