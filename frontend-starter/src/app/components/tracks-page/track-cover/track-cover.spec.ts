import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Track } from '../../../shared/models/track.model';
import { TrackCoverComponent } from './track-cover';

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Piste ${id}`,
    originalName: `${id}.mp3`,
    mimeType: 'audio/mpeg',
    size: 2048,
    createdAt: '2026-01-01T00:00:00.000Z',
    artist: null,
    album: null,
    hasCover: true,
    coverSource: 'id3',
    ...overrides,
  };
}

/** Hôte de test : pilote les entrées et la présence du composant par signaux. */
@Component({
  imports: [TrackCoverComponent],
  template: `@if (shown()) {
    <app-track-cover [track]="track()" [version]="version()" />
  }`,
})
class HostComponent {
  readonly track = signal(makeTrack('t1'));
  readonly version = signal(0);
  readonly shown = signal(true);
}

/**
 * Pochette d'une piste : Blob → ObjectURL, annulation de la requête périmée
 * (switchMap), révocation systématique et clé de version.
 */
describe('TrackCoverComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let httpMock: HttpTestingController;
  let createSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  function setup(track: Track) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    let counter = 0;
    createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cover-${++counter}`);
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    host.track.set(track);
    fixture.detectChanges();
  }

  function image(): HTMLImageElement | null {
    return fixture.nativeElement.querySelector('img');
  }

  function flushCover(id: string) {
    const request = httpMock.expectOne(`/api/tracks/${id}/cover`);
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['img'], { type: 'image/png' }));
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  it('n’émet aucune requête et affiche le visuel de remplacement sans pochette', () => {
    setup(makeTrack('t1', { hasCover: false, coverSource: null }));

    httpMock.expectNone('/api/tracks/t1/cover');
    expect(image()).toBeNull();
    expect(fixture.nativeElement.querySelector('.cover-placeholder svg')).toBeTruthy();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('affiche la pochette via une ObjectURL avec un alt pertinent', () => {
    setup(makeTrack('t1', { title: 'Blues en La' }));

    flushCover('t1');

    expect(image()?.getAttribute('src')).toBe('blob:cover-1');
    expect(image()?.getAttribute('alt')).toBe('Pochette de Blues en La');
  });

  it('révoque l’ancienne ObjectURL quand la piste change', () => {
    setup(makeTrack('t1'));
    flushCover('t1');

    host.track.set(makeTrack('t2'));
    fixture.detectChanges();

    expect(revokeSpy).toHaveBeenCalledWith('blob:cover-1');
    flushCover('t2');
    expect(image()?.getAttribute('src')).toBe('blob:cover-2');
  });

  it('annule la requête périmée si la piste change avant la réponse', () => {
    setup(makeTrack('t1'));
    const stale = httpMock.expectOne('/api/tracks/t1/cover');

    host.track.set(makeTrack('t2'));
    fixture.detectChanges();

    expect(stale.cancelled).toBe(true);
    flushCover('t2');
    expect(createSpy).toHaveBeenCalledOnce();
  });

  it('recharge la même route quand la version change (pochette modifiée)', () => {
    setup(makeTrack('t1'));
    flushCover('t1');

    host.version.set(1);
    fixture.detectChanges();

    expect(revokeSpy).toHaveBeenCalledWith('blob:cover-1');
    flushCover('t1');
    expect(image()?.getAttribute('src')).toBe('blob:cover-2');
  });

  it('ne recharge pas pour un nouvel objet Track sans changement de pochette', () => {
    setup(makeTrack('t1'));
    flushCover('t1');

    host.track.set(makeTrack('t1', { title: 'Titre modifié' }));
    fixture.detectChanges();

    httpMock.expectNone('/api/tracks/t1/cover');
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('libère l’image et ne requête plus quand la pochette est retirée', () => {
    setup(makeTrack('t1'));
    flushCover('t1');

    host.track.set(makeTrack('t1', { hasCover: false, coverSource: null }));
    fixture.detectChanges();

    expect(revokeSpy).toHaveBeenCalledWith('blob:cover-1');
    httpMock.expectNone('/api/tracks/t1/cover');
    expect(image()).toBeNull();
  });

  it('révoque l’ObjectURL à la destruction', () => {
    setup(makeTrack('t1'));
    flushCover('t1');

    host.shown.set(false);
    fixture.detectChanges();

    expect(revokeSpy).toHaveBeenCalledWith('blob:cover-1');
    expect(revokeSpy).toHaveBeenCalledOnce();
  });

  it('retombe sur le visuel de remplacement si la pochette est absente (404)', () => {
    setup(makeTrack('t1'));

    httpMock
      .expectOne('/api/tracks/t1/cover')
      .flush(new Blob(['{}']), { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(image()).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.cover-placeholder.skeleton')).toBeNull();
  });
});
