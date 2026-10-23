import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ClipService } from './clip.service';
import { Clip, ClipAnalysis, ClipSummary } from '../models/clip.model';
import { Page } from '../models/page.model';

describe('ClipService', () => {
  const analysis: ClipAnalysis = {
    version: 1,
    durationSec: 12.5,
    cuts: [1.2, 4.8],
    beats: [0.5, 1, 1.5],
    syncScore: 0.42,
  };

  const fakeSummary: ClipSummary = {
    id: 'c1',
    title: 'Course-poursuite',
    originalName: 'chase.mp4',
    mimeType: 'video/mp4',
    size: 2048,
    durationSec: 12.5,
    cutCount: 2,
    avgShotLength: 4.2,
    syncScore: 0.42,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const fakeClip: Clip = { ...fakeSummary, analysis };

  function emptyPage(page: number, limit: number): Page<ClipSummary> {
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
      clips: TestBed.inject(ClipService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('list()', () => {
    it('appelle GET /api/clips?page=1&limit=5 par défaut', () => {
      const { clips, httpMock } = setup();

      clips.list().subscribe();

      const request = httpMock.expectOne(
        (candidate) => candidate.urlWithParams === '/api/clips?page=1&limit=5',
      );
      expect(request.request.method).toBe('GET');
      expect(request.request.params.has('q')).toBe(false);

      request.flush(emptyPage(1, 5));
    });

    it('transmet page, limit et le filtre q rogné', () => {
      const { clips, httpMock } = setup();

      clips.list(3, 20, '  chase ').subscribe();

      const request = httpMock.expectOne(
        (candidate) => candidate.urlWithParams === '/api/clips?page=3&limit=20&q=chase',
      );
      expect(request.request.url).toBe('/api/clips');
      expect(request.request.params.get('q')).toBe('chase');

      request.flush(emptyPage(3, 20));
    });

    it.each([undefined, '', '   '])('n’envoie pas de paramètre q pour %j', (q) => {
      const { clips, httpMock } = setup();

      clips.list(2, 5, q).subscribe();

      const request = httpMock.expectOne('/api/clips?page=2&limit=5');
      expect(request.request.params.has('q')).toBe(false);

      request.flush(emptyPage(2, 5));
    });

    it('propage l’erreur HTTP au lieu de la masquer', () => {
      const { clips, httpMock } = setup();
      let caughtStatus = 0;

      clips
        .list()
        .subscribe({ error: (error: { status: number }) => (caughtStatus = error.status) });
      httpMock
        .expectOne('/api/clips?page=1&limit=5')
        .flush({ message: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      expect(caughtStatus).toBe(401);
    });
  });

  describe('get()', () => {
    it('appelle GET /api/clips/:id et restitue le clip avec son analyse', () => {
      const { clips, httpMock } = setup();
      let received: Clip | undefined;

      clips.get('c1').subscribe((clip) => (received = clip));

      const request = httpMock.expectOne('/api/clips/c1');
      expect(request.request.method).toBe('GET');
      request.flush(fakeClip);

      expect(received).toEqual(fakeClip);
    });
  });

  describe('upload()', () => {
    const video = new File(['octets-video'], 'chase.mp4', { type: 'video/mp4' });

    it('poste un multipart video + title + analysis sérialisée en JSON', () => {
      const { clips, httpMock } = setup();

      clips.upload(video, 'Course-poursuite', analysis).subscribe();

      const request = httpMock.expectOne('/api/clips');
      expect(request.request.method).toBe('POST');
      expect(request.request.reportProgress).toBe(true);
      const body = request.request.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect((body.get('video') as File).name).toBe('chase.mp4');
      expect(body.get('title')).toBe('Course-poursuite');
      expect(JSON.parse(body.get('analysis') as string)).toEqual(analysis);
      expect([...body.keys()]).toEqual(['video', 'title', 'analysis']);

      request.flush(fakeClip);
    });
  });

  describe('video()', () => {
    it('appelle GET /api/clips/:id/video en responseType blob', () => {
      const { clips, httpMock } = setup();
      let received: Blob | undefined;

      clips.video('c1').subscribe((blob) => (received = blob));

      const request = httpMock.expectOne('/api/clips/c1/video');
      expect(request.request.method).toBe('GET');
      expect(request.request.responseType).toBe('blob');
      request.flush(new Blob(['octets-video'], { type: 'video/mp4' }));

      expect(received?.type).toBe('video/mp4');
    });
  });

  describe('remove()', () => {
    it('appelle DELETE /api/clips/:id sans corps', () => {
      const { clips, httpMock } = setup();

      clips.remove('c1').subscribe();

      const request = httpMock.expectOne('/api/clips/c1');
      expect(request.request.method).toBe('DELETE');
      expect(request.request.body).toBeNull();

      request.flush(null, { status: 204, statusText: 'No Content' });
    });
  });
});
