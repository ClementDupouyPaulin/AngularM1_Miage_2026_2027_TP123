import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { Clip } from '../../shared/models/clip.model';
import { FriendsOverview } from '../../shared/models/friend.model';
import { ClipService } from '../../shared/services/clip.service';
import { FriendService } from '../../shared/services/friend.service';
import { SHARE_DIALOG_PANEL_CLASS, ShareDialogComponent, ShareDialogData, sharePatch } from './share-dialog';

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    title: 'Poursuite',
    originalName: 'poursuite.mp4',
    mimeType: 'video/mp4',
    size: 1024,
    durationSec: 30,
    cutCount: 0,
    avgShotLength: 30,
    syncScore: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    tags: [],
    visibility: 'private',
    owner: { id: 'u1', name: 'Moi' },
    isOwner: true,
    hasFilmstrip: false,
    sparkline: [],
    analysis: {
      version: 2,
      durationSec: 30,
      fps: 10,
      cuts: [],
      beats: [],
      syncScore: null,
      diffs: [],
      palette: [],
      transitions: [],
      thumbnailTimes: [0],
      sensitivity: 3,
    },
    annotations: [],
    sharedWith: [],
    ...overrides,
  };
}

const OVERVIEW: FriendsOverview = {
  friends: [
    { friendshipId: 'f1', user: { id: 'u2', name: 'Alice', email: 'alice@example.com' }, since: '2026-01-01' },
    { friendshipId: 'f2', user: { id: 'u3', name: 'Bruno', email: 'bruno@example.com' }, since: '2026-01-02' },
  ],
  requests: [],
};

describe('sharePatch', () => {
  it('garde les amis en mode partagé et vide la liste sinon', () => {
    expect(sharePatch('shared', ['u2'])).toEqual({ visibility: 'shared', sharedWith: ['u2'] });
    expect(sharePatch('public', ['u2'])).toEqual({ visibility: 'public', sharedWith: [] });
    expect(sharePatch('private', [])).toEqual({ visibility: 'private', sharedWith: [] });
  });
});

describe('ShareDialogComponent', () => {
  let clips: { patch: ReturnType<typeof vi.fn> };
  let friends: { overview: ReturnType<typeof vi.fn> };
  let dialogRef: MatDialogRef<ShareDialogComponent, Clip>;
  let close: ReturnType<typeof vi.spyOn>;

  function open(clip: Clip, overview: Observable<FriendsOverview> = of(OVERVIEW)) {
    friends.overview.mockReturnValue(overview);
    dialogRef = TestBed.inject(MatDialog).open<ShareDialogComponent, ShareDialogData, Clip>(ShareDialogComponent, {
      data: { clip },
      panelClass: SHARE_DIALOG_PANEL_CLASS,
    });
    close = vi.spyOn(dialogRef, 'close');
    TestBed.tick();
  }

  const container = () => document.querySelector('mat-dialog-container') as HTMLElement;
  const radio = (value: string) => container().querySelector(`input[type="radio"][value="${value}"]`) as HTMLInputElement;
  const checkboxes = () => Array.from(container().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const save = () => container().querySelector('.share-save') as HTMLButtonElement;

  function choose(input: HTMLInputElement) {
    input.click();
    TestBed.tick();
  }

  beforeEach(() => {
    clips = { patch: vi.fn() };
    friends = { overview: vi.fn() };
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClipService, useValue: clips },
        { provide: FriendService, useValue: friends },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.restoreAllMocks();
  });

  it('coche la visibilité actuelle et les amis déjà autorisés', () => {
    open(makeClip({ visibility: 'shared', sharedWith: [{ id: 'u3', name: 'Bruno' }] }));
    expect(radio('shared').checked).toBe(true);
    expect(checkboxes().map((box) => box.checked)).toEqual([false, true]);
    expect(container().textContent).toContain('alice@example.com');
  });

  it('n’affiche la liste d’amis qu’en mode partagé', () => {
    open(makeClip());
    expect(checkboxes()).toHaveLength(0);
    choose(radio('shared'));
    expect(checkboxes()).toHaveLength(2);
  });

  it('invite à ajouter des amis quand la liste est vide', () => {
    open(makeClip({ visibility: 'shared' }), of({ friends: [], requests: [] }));
    const link = container().querySelector('a[href="/friends"]');
    expect(link?.textContent).toContain('Inviter des amis');
    expect(container().textContent).toContain('aucun ami');
  });

  it('signale l’échec du chargement des amis', () => {
    open(makeClip({ visibility: 'shared' }), throwError(() => new HttpErrorResponse({ status: 500 })));
    expect(container().querySelector('[role="alert"]')?.textContent).toContain('Impossible de charger vos amis');
  });

  it('enregistre le partage et ferme avec l’extrait mis à jour', () => {
    const updated = makeClip({ visibility: 'shared', sharedWith: [{ id: 'u2', name: 'Alice' }] });
    clips.patch.mockReturnValue(of(updated));
    open(makeClip());
    choose(radio('shared'));
    choose(checkboxes()[0]);
    save().click();
    TestBed.tick();
    expect(clips.patch).toHaveBeenCalledWith('c1', { visibility: 'shared', sharedWith: ['u2'] });
    expect(close).toHaveBeenCalledWith(updated);
  });

  it('refuse un partage sans ami coché', () => {
    open(makeClip());
    choose(radio('shared'));
    save().click();
    TestBed.tick();
    expect(clips.patch).not.toHaveBeenCalled();
    expect(container().querySelector('.share-error')?.textContent).toContain('au moins un ami');
  });

  it('rend un extrait public en vidant la liste de partage', () => {
    clips.patch.mockReturnValue(of(makeClip({ visibility: 'public' })));
    open(makeClip({ visibility: 'shared', sharedWith: [{ id: 'u2', name: 'Alice' }] }));
    choose(radio('public'));
    save().click();
    TestBed.tick();
    expect(clips.patch).toHaveBeenCalledWith('c1', { visibility: 'public', sharedWith: [] });
  });

  it('affiche l’erreur du serveur sans fermer', () => {
    clips.patch.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Ami inconnu' } })),
    );
    open(makeClip({ visibility: 'public' }));
    save().click();
    TestBed.tick();
    expect(container().querySelector('.share-error')?.textContent).toContain('Ami inconnu');
    expect(close).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
  });

  it('décoche un ancien ami qui n’est plus dans la liste', () => {
    clips.patch.mockReturnValue(of(makeClip()));
    open(makeClip({ visibility: 'shared', sharedWith: [{ id: 'u2', name: 'Alice' }, { id: 'gone', name: 'Ex' }] }));
    save().click();
    TestBed.tick();
    expect(clips.patch).toHaveBeenCalledWith('c1', { visibility: 'shared', sharedWith: ['u2'] });
  });
});
