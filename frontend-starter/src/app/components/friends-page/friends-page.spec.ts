import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  ActivityEvent,
  FriendEntry,
  FriendRequest,
  FriendsOverview,
} from '../../shared/models/friend.model';
import { ActivityService } from '../../shared/services/activity.service';
import { FriendService } from '../../shared/services/friend.service';
import { FriendsPageComponent, inviteErrorMessage } from './friends-page';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');

function user(id: string, name: string) {
  return { id, name, email: `${id}@exemple.fr` };
}

function entry(id: string, name: string): FriendEntry {
  return { friendshipId: id, user: user(`u-${id}`, name), since: '2026-03-15T10:00:00.000Z' };
}

function request(id: string, name: string, direction: FriendRequest['direction']): FriendRequest {
  return { id, user: user(`u-${id}`, name), direction, createdAt: '2026-10-26T11:55:00.000Z' };
}

describe('FriendsPageComponent', () => {
  let fixture: ComponentFixture<FriendsPageComponent>;
  let friendService: Record<'overview' | 'invite' | 'accept' | 'remove', ReturnType<typeof vi.fn>>;
  let activityService: { recent: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let dialog: { open: ReturnType<typeof vi.fn> };

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(selector: string): string {
    return element().querySelector(selector)?.textContent ?? '';
  }

  function click(selector: string): void {
    (element().querySelector(selector) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function setup(
    overview: FriendsOverview = {
      friends: [entry('f1', 'Ada Lovelace')],
      requests: [request('r1', 'Grace Hopper', 'incoming'), request('r2', 'Alan Turing', 'outgoing')],
    },
    events: ActivityEvent[] = [],
  ) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    friendService = {
      overview: vi.fn(() => of(overview)),
      invite: vi.fn(),
      accept: vi.fn(),
      remove: vi.fn(() => of(undefined)),
    };
    activityService = { recent: vi.fn(() => of(events)) };
    snackBar = { open: vi.fn() };
    dialog = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FriendService, useValue: friendService },
        { provide: ActivityService, useValue: activityService },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: dialog },
      ],
    });
    fixture = TestBed.createComponent(FriendsPageComponent);
    fixture.detectChanges();
  }

  function submitInvite(email: string): void {
    const input = element().querySelector('#invite-email') as HTMLInputElement;
    input.value = email;
    input.dispatchEvent(new Event('input'));
    (element().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  afterEach(() => vi.useRealTimers());

  it('affiche amis, invitations reçues et envoyées', () => {
    setup();
    expect(text('.friend')).toContain('Ada Lovelace');
    expect(text('.friend')).toContain('Ami depuis mars 2026');
    expect(text('.friend .avatar')).toBe('AL');
    expect(text('.incoming-request')).toContain('Grace Hopper');
    expect(text('.incoming-request')).toContain('il y a 5 minutes');
    expect(text('.outgoing-request')).toContain('Alan Turing');
  });

  describe('invitation', () => {
    it('valide l’adresse avant tout envoi', () => {
      setup();
      submitInvite('pas-une-adresse');
      expect(friendService.invite).not.toHaveBeenCalled();
      expect(text('#invite-email-error')).toContain('pas valide');
    });

    it('affiche tel quel le message générique du serveur et recharge les invitations', () => {
      setup();
      friendService.invite.mockReturnValue(of({ message: 'Si ce compte existe, il a reçu votre invitation.' }));
      submitInvite('  grace@exemple.fr ');
      expect(friendService.invite).toHaveBeenCalledWith('grace@exemple.fr');
      expect(text('.invite-success')).toBe('Si ce compte existe, il a reçu votre invitation.');
      expect(friendService.overview).toHaveBeenCalledTimes(2);
      expect((element().querySelector('#invite-email') as HTMLInputElement).value).toBe('');
    });

    it('explique un 409', () => {
      setup();
      friendService.invite.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      submitInvite('ada@exemple.fr');
      expect(text('.invite-error')).toContain('déjà votre amie');
    });

    it('explique un 400', () => {
      setup();
      friendService.invite.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
      submitInvite('moi@exemple.fr');
      expect(text('.invite-error')).toContain('vous inviter vous-même');
    });

    it('a un message de repli pour les autres erreurs', () => {
      expect(inviteErrorMessage(new HttpErrorResponse({ status: 500 }))).toContain('pas pu être envoyée');
      expect(inviteErrorMessage(new HttpErrorResponse({ status: 0 }))).toContain('injoignable');
    });
  });

  it('accepter ajoute l’ami, retire l’invitation et rafraîchit l’activité', () => {
    setup();
    friendService.accept.mockReturnValue(of(entry('r1', 'Grace Hopper')));
    click('.accept');
    expect(friendService.accept).toHaveBeenCalledWith('r1');
    expect(element().querySelector('.incoming-request')).toBeNull();
    expect(element().querySelectorAll('.friend').length).toBe(2);
    expect(text('.friend')).toContain('Grace Hopper');
    expect(activityService.recent).toHaveBeenCalledTimes(2);
    expect(snackBar.open.mock.calls[0][0]).toContain('Grace Hopper');
  });

  it('refuser supprime l’invitation reçue', () => {
    setup();
    click('.decline');
    expect(friendService.remove).toHaveBeenCalledWith('r1');
    expect(element().querySelector('.incoming-request')).toBeNull();
  });

  it('annuler supprime l’invitation envoyée', () => {
    setup();
    click('.cancel');
    expect(friendService.remove).toHaveBeenCalledWith('r2');
    expect(element().querySelector('.outgoing-request')).toBeNull();
  });

  it('retirer un ami demande confirmation', () => {
    setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    click('.remove-friend');
    expect(friendService.remove).not.toHaveBeenCalled();

    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    click('.remove-friend');
    expect(friendService.remove).toHaveBeenCalledWith('f1');
    expect(element().querySelector('.friend')).toBeNull();
    expect(element().querySelector('.friends .empty-state')).not.toBeNull();
    expect(activityService.recent).toHaveBeenCalledTimes(2);
  });

  it('signale l’échec d’une action sans perdre la liste', () => {
    setup();
    friendService.accept.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    click('.accept');
    expect(element().querySelector('.incoming-request')).not.toBeNull();
    expect(snackBar.open.mock.calls[0][0]).toContain('n’existe plus');
  });

  describe('fil d’activité', () => {
    const events: ActivityEvent[] = [
      { id: 'e1', type: 'clip', actor: { id: 'u1', name: 'Ada' }, clipId: 'c1', clipTitle: 'Plage', at: '2026-10-26T11:58:00.000Z' },
      {
        id: 'e2',
        type: 'annotation',
        actor: { id: 'u2', name: 'Grace' },
        clipId: 'c2',
        clipTitle: 'Nuit',
        text: 'Superbe raccord',
        at: '2026-10-25T09:00:00.000Z',
      },
      { id: 'e3', type: 'friend', actor: { id: 'u3', name: 'Alan' }, at: '2026-10-26T11:59:50.000Z' },
    ];

    it('rend chaque type d’événement avec liens et dates relatives', () => {
      setup(undefined, events);
      expect(activityService.recent).toHaveBeenCalledWith(20);
      const items = element().querySelectorAll('.event');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toContain('Ada');
      expect(items[0].textContent).toContain('a ajouté');
      expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/clips/c1');
      expect(items[0].querySelector('time')?.textContent?.trim()).toBe('il y a 2 minutes');
      expect(items[1].textContent).toContain('a annoté');
      expect(items[1].querySelector('q')?.textContent).toBe('Superbe raccord');
      expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/clips/c2');
      expect(items[1].querySelector('time')?.textContent?.trim()).toBe('hier');
      expect(items[2].textContent).toContain('est maintenant votre ami');
      expect(items[2].querySelector('time')?.textContent?.trim()).toBe('à l’instant');
    });

    it('affiche l’état vide et se rafraîchit à la demande', () => {
      setup(undefined, []);
      expect(text('.activity-empty')).toContain('Rien de neuf');

      activityService.recent.mockReturnValue(of(events.slice(0, 1)));
      click('.refresh-activity');
      expect(element().querySelectorAll('.event').length).toBe(1);
    });

    it('affiche une erreur si le fil est indisponible', () => {
      setup();
      activityService.recent.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      click('.refresh-activity');
      expect(text('.activity-error')).toContain('indisponible');
    });
  });
});
