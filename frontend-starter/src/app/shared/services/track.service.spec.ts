import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TrackService } from './track.service';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';
import { CoverSearchResult } from '../models/cover-search-result.model';

/**
 * Mission 7 du TP3 : « TrackService.list() transmet page et limit ».
 * On vérifie l'URL réellement construite par HttpClient (`urlWithParams`) et
 * pas seulement le fait que la méthode a été appelée : c'est la seule façon
 * de détecter une params mal nommée ou oubliée.
 *
 * Les bonus (filtre `q`, pochettes) suivent le contrat additif : mêmes
 * vérifications d'URL, de méthode, de corps et de `responseType`.
 */
describe('TrackService', () => {
  const fakeTrack: Track = {
    id: 't1',
    title: 'Blues en La',
    originalName: 'blues.mp3',
    mimeType: 'audio/mpeg',
    size: 1024,
    createdAt: '2026-01-01T00:00:00.000Z',
    artist: null,
    album: null,
    hasCover: false,
    coverSource: null,
  };

  /** Page vide conforme au contrat (5 clés historiques + 4 champs ajoutés). */
  function emptyPage(page: number, limit: number): Page<Track> {
    return {
      items: [],
      page,
      limit,
      total: 0,
      pages: 0,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    };
  }

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    return {
      tracks: TestBed.inject(TrackService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('list()', () => {
    it('appelle GET /api/tracks?page=1&limit=5 par défaut', () => {
      const { tracks, httpMock } = setup();

      tracks.list().subscribe();

      const request = httpMock.expectOne(
        (candidate) => candidate.urlWithParams === '/api/tracks?page=1&limit=5',
      );
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('page')).toBe('1');
      expect(request.request.params.get('limit')).toBe('5');

      request.flush(emptyPage(1, 5));
    });

    it('transmet les valeurs de page et limit demandées dans la query string', () => {
      const { tracks, httpMock } = setup();

      tracks.list(3, 20).subscribe();

      const request = httpMock.expectOne(
        (candidate) => candidate.urlWithParams === '/api/tracks?page=3&limit=20',
      );
      expect(request.request.url).toBe('/api/tracks');
      expect(request.request.params.get('page')).toBe('3');
      expect(request.request.params.get('limit')).toBe('20');

      request.flush(emptyPage(3, 20));
    });

    it('restitue la page renvoyée par l’API telle quelle', () => {
      const { tracks, httpMock } = setup();
      const response: Page<Track> = {
        items: [fakeTrack],
        page: 2,
        limit: 5,
        total: 6,
        pages: 2,
        hasPrevPage: true,
        hasNextPage: false,
        prevPage: 1,
        nextPage: null,
      };
      let received: Page<Track> | undefined;

      tracks.list(2, 5).subscribe((page) => (received = page));
      httpMock
        .expectOne((candidate) => candidate.urlWithParams === '/api/tracks?page=2&limit=5')
        .flush(response);

      expect(received).toEqual(response);
      expect(received?.items).toHaveLength(1);
    });

    it('propage l’erreur HTTP au lieu de la masquer', () => {
      const { tracks, httpMock } = setup();
      let caughtStatus = 0;

      tracks
        .list(1, 5)
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne((candidate) => candidate.urlWithParams === '/api/tracks?page=1&limit=5')
        .flush({ message: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      expect(caughtStatus).toBe(401);
    });

    it('transmet le filtre q rogné après page et limit', () => {
      const { tracks, httpMock } = setup();

      tracks.list(1, 10, '  blues ').subscribe();

      const request = httpMock.expectOne(
        (candidate) => candidate.urlWithParams === '/api/tracks?page=1&limit=10&q=blues',
      );
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('q')).toBe('blues');

      request.flush(emptyPage(1, 10));
    });

    it.each([undefined, '', '   '])('n’envoie pas de paramètre q pour %j', (q) => {
      const { tracks, httpMock } = setup();

      tracks.list(2, 5, q).subscribe();

      const request = httpMock.expectOne('/api/tracks?page=2&limit=5');
      expect(request.request.params.has('q')).toBe(false);

      request.flush(emptyPage(2, 5));
    });
  });

  describe('upload()', () => {
    const audio = new File(['octets-audio'], 'blues.mp3', { type: 'audio/mpeg' });

    it('poste un multipart audio + title, sans champ cover par défaut', () => {
      const { tracks, httpMock } = setup();

      tracks.upload(audio, 'Blues en La').subscribe();

      const request = httpMock.expectOne('/api/tracks');
      expect(request.request.method).toBe('POST');
      expect(request.request.reportProgress).toBe(true);
      const body = request.request.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('audio')).toBeInstanceOf(File);
      expect(body.get('title')).toBe('Blues en La');
      expect(body.has('cover')).toBe(false);

      request.flush(fakeTrack);
    });

    it('ajoute le champ cover quand une image est fournie', () => {
      const { tracks, httpMock } = setup();
      const cover = new File(['png'], 'pochette.png', { type: 'image/png' });

      tracks.upload(audio, 'Blues en La', cover).subscribe();

      const request = httpMock.expectOne('/api/tracks');
      const body = request.request.body as FormData;
      expect((body.get('cover') as File).name).toBe('pochette.png');

      request.flush(fakeTrack);
    });
  });

  describe('pochettes', () => {
    it('cover() lit GET /api/tracks/:id/cover en responseType blob', () => {
      const { tracks, httpMock } = setup();
      let received: Blob | undefined;

      tracks.cover('t1').subscribe((blob) => (received = blob));

      const request = httpMock.expectOne('/api/tracks/t1/cover');
      expect(request.request.method).toBe('GET');
      expect(request.request.responseType).toBe('blob');
      request.flush(new Blob(['img'], { type: 'image/png' }));

      expect(received?.type).toBe('image/png');
    });

    it('setCover() envoie PUT multipart avec le seul champ cover', () => {
      const { tracks, httpMock } = setup();
      const image = new File(['jpg'], 'pochette.jpg', { type: 'image/jpeg' });

      tracks.setCover('t1', image).subscribe();

      const request = httpMock.expectOne('/api/tracks/t1/cover');
      expect(request.request.method).toBe('PUT');
      const body = request.request.body as FormData;
      expect((body.get('cover') as File).name).toBe('pochette.jpg');
      expect([...body.keys()]).toEqual(['cover']);

      request.flush({ ...fakeTrack, hasCover: true, coverSource: 'upload' } satisfies Track);
    });

    it('removeCover() envoie DELETE /api/tracks/:id/cover sans corps', () => {
      const { tracks, httpMock } = setup();

      tracks.removeCover('t1').subscribe();

      const request = httpMock.expectOne('/api/tracks/t1/cover');
      expect(request.request.method).toBe('DELETE');
      expect(request.request.body).toBeNull();

      request.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('searchCover() appelle GET /api/tracks/:id/cover/search et restitue le résultat', () => {
      const { tracks, httpMock } = setup();
      const response: CoverSearchResult = {
        query: 'Blues en La',
        source: 'itunes',
        attribution: 'Pochettes fournies par iTunes',
        results: [
          {
            id: '1',
            title: 'Blues en La',
            artist: 'Artiste',
            album: 'Album',
            imageUrl: 'https://is1-ssl.mzstatic.com/image.jpg',
          },
        ],
      };
      let received: CoverSearchResult | undefined;

      tracks.searchCover('t1').subscribe((result) => (received = result));

      const request = httpMock.expectOne('/api/tracks/t1/cover/search');
      expect(request.request.method).toBe('GET');
      expect(request.request.responseType).toBe('json');
      request.flush(response);

      expect(received).toEqual(response);
    });

    it('setCoverFromWeb() poste { imageUrl } en JSON sur /cover/web', () => {
      const { tracks, httpMock } = setup();
      const imageUrl = 'https://is1-ssl.mzstatic.com/image.jpg';

      tracks.setCoverFromWeb('t1', imageUrl).subscribe();

      const request = httpMock.expectOne('/api/tracks/t1/cover/web');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ imageUrl });

      request.flush({ ...fakeTrack, hasCover: true, coverSource: 'web' } satisfies Track);
    });
  });

  describe('remove()', () => {
    /**
     * Mission 5/7 : « la suppression appelle DELETE /api/tracks/:id ». Test au
     * niveau service uniquement : la partie « recharge la liste » relève du
     * composant tracks-page, dont l'interface n'est pas encore stabilisée.
     * Méthode et URL sont imposées par API_CONTRACT.md.
     */
    it('appelle DELETE /api/tracks/:id', () => {
      const { tracks, httpMock } = setup();

      tracks.remove('t1').subscribe();

      const request = httpMock.expectOne('/api/tracks/t1');
      expect(request.request.method).toBe('DELETE');
      expect(request.request.body).toBeNull();

      request.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('propage un 404 quand la piste a déjà été supprimée ailleurs', () => {
      const { tracks, httpMock } = setup();
      let caughtStatus = 0;

      tracks
        .remove('deja-supprimee')
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne('/api/tracks/deja-supprimee')
        .flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });

      expect(caughtStatus).toBe(404);
    });
  });

  describe('audio()', () => {
    it('appelle GET /api/tracks/:id/audio en responseType blob', () => {
      const { tracks, httpMock } = setup();

      tracks.audio('t1').subscribe();

      const request = httpMock.expectOne('/api/tracks/t1/audio');
      expect(request.request.method).toBe('GET');
      // Sans responseType 'blob', Angular tenterait de parser l'audio en JSON.
      expect(request.request.responseType).toBe('blob');

      request.flush(new Blob(['octets-audio'], { type: 'audio/mpeg' }));
    });

    it('insère l’identifiant reçu dans l’URL', () => {
      const { tracks, httpMock } = setup();

      tracks.audio('autre-id').subscribe();

      const request = httpMock.expectOne('/api/tracks/autre-id/audio');
      expect(request.request.urlWithParams).toBe('/api/tracks/autre-id/audio');

      request.flush(new Blob([''], { type: 'audio/mpeg' }));
    });

    it('émet le Blob renvoyé par l’API', () => {
      const { tracks, httpMock } = setup();
      let received: Blob | undefined;

      tracks.audio('t1').subscribe((blob) => (received = blob));
      httpMock
        .expectOne('/api/tracks/t1/audio')
        .flush(new Blob(['octets-audio'], { type: 'audio/mpeg' }));

      expect(received).toBeInstanceOf(Blob);
      expect(received?.type).toBe('audio/mpeg');
    });
  });
});
