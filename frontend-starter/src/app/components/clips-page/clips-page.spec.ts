import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import {
  ClipsPageComponent,
  MAX_CLIP_FILE_SIZE,
  SEARCH_DEBOUNCE_MS,
  TITLE_MAX_LENGTH,
  formatDuration,
  syncScoreLabel,
  validateClipFile,
} from './clips-page';
import { Clip, ClipAnalysis, ClipSummary } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { ClipService } from '../../shared/services/clip.service';
import {
  ClipAnalysisError,
  ClipAnalyzeOptions,
  ClipAnalyzerService,
} from '../../shared/services/clip-analyzer.service';

describe('ClipsPageComponent', () => {
  function makeClip(id: string, title = `Extrait ${id}`): ClipSummary {
    return {
      id,
      title,
      originalName: `${id}.mp4`,
      mimeType: 'video/mp4',
      size: 2048,
      durationSec: 75,
      cutCount: 12,
      avgShotLength: 5.8,
      syncScore: 1.6,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function makePage(items: ClipSummary[], overrides: Partial<Page<ClipSummary>> = {}): Page<ClipSummary> {
    const base = { items, page: 1, limit: 5, total: items.length, pages: 1, ...overrides };
    return {
      hasPrevPage: base.page > 1,
      hasNextPage: base.page < base.pages,
      prevPage: null,
      nextPage: null,
      ...base,
    };
  }

  const analysis: ClipAnalysis = {
    version: 1,
    durationSec: 10,
    cuts: [2, 5, 8],
    beats: [1, 2, 3, 4, 5],
    syncScore: 1.5,
  };

  function videoFile(name = 'extrait.mp4', type = 'video/mp4'): File {
    return new File(['octets-video'], name, { type });
  }

  let fixture: ComponentFixture<ClipsPageComponent>;
  let component: ClipsPageComponent;
  let service: { list: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let analyzer: { analyze: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let dialog: { open: ReturnType<typeof vi.fn> };

  function setup(initial: Page<ClipSummary> = makePage([makeClip('c1')])) {
    service = { list: vi.fn(() => of(initial)), upload: vi.fn(), remove: vi.fn() };
    analyzer = { analyze: vi.fn() };
    snackBar = { open: vi.fn() };
    dialog = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ClipsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ClipService, useValue: service },
        { provide: ClipAnalyzerService, useValue: analyzer },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: dialog },
      ],
    });
    fixture = TestBed.createComponent(ClipsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function text(selector: string): string {
    return (fixture.nativeElement.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function confirmWith(result: boolean | undefined) {
    dialog.open.mockReturnValue({ afterClosed: () => of(result) });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('fonctions utilitaires', () => {
    it('interprète le score de synchronisation', () => {
      expect(syncScoreLabel(null)).toBe('bande-son non analysable');
      expect(syncScoreLabel(1)).toBe('sans lien avec la musique');
      expect(syncScoreLabel(2.4)).toBe('calé sur la musique');
    });

    it('formate une durée en m:ss', () => {
      expect(formatDuration(75)).toBe('1:15');
      expect(formatDuration(5)).toBe('0:05');
    });
  });

  describe('validation du fichier', () => {
    it('accepte MP4 et WebM, y compris sans type MIME', () => {
      expect(validateClipFile(videoFile())).toBeUndefined();
      expect(validateClipFile(videoFile('a.webm', 'video/webm'))).toBeUndefined();
      expect(validateClipFile(videoFile('a.webm', ''))).toBeUndefined();
    });

    it('refuse un autre format, un fichier trop lourd ou vide', () => {
      expect(validateClipFile(videoFile('a.avi', 'video/x-msvideo'))).toContain('Format non accepté');
      const big = videoFile();
      Object.defineProperty(big, 'size', { value: MAX_CLIP_FILE_SIZE + 1 });
      expect(validateClipFile(big)).toContain('trop volumineux');
      expect(validateClipFile(new File([], 'vide.mp4', { type: 'video/mp4' }))).toContain('vide');
    });

    it('affiche l’erreur et bloque l’analyse pour un fichier refusé', () => {
      setup();
      component.selectFile(videoFile('a.mov', 'video/quicktime'));
      fixture.detectChanges();

      expect(text('#file-error')).toContain('MP4, WebM');
      expect(component.canAnalyze()).toBe(false);
    });
  });

  describe('analyse puis envoi', () => {
    it('affiche la progression, le résultat, puis envoie et recharge la page 1', async () => {
      setup();
      let resolve!: (value: ClipAnalysis) => void;
      analyzer.analyze.mockImplementation((_file: File, options: ClipAnalyzeOptions) => {
        options.onProgress?.(0.42);
        return new Promise<ClipAnalysis>((done) => (resolve = done));
      });

      const file = videoFile();
      component.selectFile(file);
      component.title.setValue('  Poursuite  ');
      const running = component.analyze();
      fixture.detectChanges();

      expect(component.analyzing()).toBe(true);
      expect(fixture.nativeElement.querySelector('.analysis-progress').value).toBe(42);
      expect(component.canUpload()).toBe(false);

      resolve(analysis);
      await running;
      fixture.detectChanges();

      expect(text('.stat-cuts')).toBe('3');
      expect(text('.stat-asl')).toBe('2,5 s');
      expect(text('.stat-beats')).toBe('5');
      expect(text('.stat-sync')).toContain('calé sur la musique');

      const events = new Subject<unknown>();
      service.upload.mockReturnValue(events);
      service.list.mockClear();
      component.upload();

      expect(service.upload).toHaveBeenCalledWith(file, 'Poursuite', analysis);
      events.next({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
      expect(component.uploadProgress()).toBe(50);

      const created = { ...makeClip('c9', 'Poursuite'), analysis } satisfies Clip;
      events.next(new HttpResponse({ body: created, status: 201 }));

      expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Poursuite'), 'Fermer', expect.anything());
      expect(service.list).toHaveBeenCalledWith(1, 5, '');
      expect(component.file()).toBeUndefined();
      expect(component.analysis()).toBeNull();
    });

    it('tronque le titre de repli (nom de fichier) à TITLE_MAX_LENGTH', async () => {
      setup();
      analyzer.analyze.mockResolvedValue(analysis);
      const file = videoFile(`${'a'.repeat(TITLE_MAX_LENGTH + 10)}.mp4`);
      component.selectFile(file);
      await component.analyze();
      service.upload.mockReturnValue(new Subject<unknown>());

      component.upload();

      expect(service.upload).toHaveBeenCalledWith(file, 'a'.repeat(TITLE_MAX_LENGTH), analysis);
    });

    it('affiche le message serveur si l’envoi échoue', async () => {
      setup();
      analyzer.analyze.mockResolvedValue(analysis);
      component.selectFile(videoFile());
      await component.analyze();
      service.upload.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Analyse invalide' } })),
      );

      component.upload();
      fixture.detectChanges();

      expect(text('.upload-error')).toBe('Analyse invalide');
    });

    it('annule l’analyse via AbortController', async () => {
      setup();
      let signal!: AbortSignal;
      analyzer.analyze.mockImplementation(
        (_file: File, options: ClipAnalyzeOptions) =>
          new Promise((_resolve, reject) => {
            signal = options.signal!;
            signal.addEventListener('abort', () => reject(new ClipAnalysisError('aborted')));
          }),
      );
      component.selectFile(videoFile());
      const running = component.analyze();

      component.cancelAnalysis();
      await running;
      fixture.detectChanges();

      expect(signal.aborted).toBe(true);
      expect(component.analyzing()).toBe(false);
      expect(component.analysis()).toBeNull();
      expect(text('.status .notice')).toBe('Analyse annulée.');
      expect(fixture.nativeElement.querySelector('.analysis-error')).toBeNull();
    });

    it('affiche le message d’une ClipAnalysisError', async () => {
      setup();
      analyzer.analyze.mockRejectedValue(new ClipAnalysisError('too-long'));
      component.selectFile(videoFile());

      await component.analyze();
      fixture.detectChanges();

      expect(text('.analysis-error')).toBe(new ClipAnalysisError('too-long').message);
      expect(component.canUpload()).toBe(false);
    });
  });

  describe('liste', () => {
    it('affiche les cartes avec durée, stats et lien vers le pouls', () => {
      setup(makePage([makeClip('c1', 'Course')]));

      expect(service.list).toHaveBeenCalledWith(1, 5, '');
      expect(text('.clip-title')).toBe('Course');
      expect(text('.clip-head .badge')).toContain('1:15');
      expect(text('.clip-stats')).toContain('5,8 s');
      expect(fixture.nativeElement.querySelector('.pulse-link').getAttribute('href')).toBe('/clips/c1');
    });

    it('affiche l’état vide et le message d’erreur serveur', () => {
      setup(makePage([]));
      expect(text('.empty-list')).toContain('Aucun extrait');

      service.list.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Base indisponible' } })),
      );
      component.load();
      fixture.detectChanges();
      expect(text('.list-error')).toBe('Base indisponible');
    });

    it('filtre par titre après l’anti-rebond', () => {
      vi.useFakeTimers();
      setup();
      service.list.mockClear();

      component.search.setValue('  course ');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(service.list).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(service.list).toHaveBeenCalledOnce();
      expect(service.list).toHaveBeenCalledWith(1, 5, 'course');
      expect(component.query()).toBe('course');
    });
  });

  describe('suppression', () => {
    it('ne supprime rien si la confirmation est refusée', () => {
      setup();
      confirmWith(false);

      component.remove(makeClip('c1'));

      expect(dialog.open).toHaveBeenCalledOnce();
      expect(service.remove).not.toHaveBeenCalled();
    });

    it('supprime après confirmation, notifie et recharge', () => {
      setup();
      confirmWith(true);
      service.remove.mockReturnValue(of(undefined));
      service.list.mockClear();

      component.remove(makeClip('c1', 'Course'));

      expect(service.remove).toHaveBeenCalledWith('c1');
      expect(snackBar.open).toHaveBeenCalledWith('« Course » a été supprimé.', 'Fermer', expect.anything());
      expect(service.list).toHaveBeenCalledOnce();
      expect(component.deletingId()).toBe('');
    });
  });
});
