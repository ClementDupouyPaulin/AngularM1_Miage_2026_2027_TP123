import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import {
  ClipsPageComponent,
  MAX_CLIP_FILE_SIZE,
  MAX_TAGS,
  SEARCH_DEBOUNCE_MS,
  TAG_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  liveDiffPath,
  liveSwatches,
  normalizeTag,
  validateClipFile,
} from './clips-page';
import { rebuildAnalysis } from '../../shared/analysis/redetect';
import { Clip, ClipAnalysis, ClipSummary, LibraryStats } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { ClipService } from '../../shared/services/clip.service';
import {
  ClipAnalysisError,
  ClipAnalysisResult,
  ClipAnalyzeOptions,
  ClipAnalyzerService,
} from '../../shared/services/clip-analyzer.service';

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
    tags: [],
    visibility: 'private',
    owner: { id: 'u1', name: 'Alice' },
    isOwner: true,
    hasFilmstrip: false,
    sparkline: [],
  };
}

function makePage(items: ClipSummary[], overrides: Partial<Page<ClipSummary>> = {}): Page<ClipSummary> {
  const base = { items, page: 1, limit: 12, total: items.length, pages: 1, ...overrides };
  return { hasPrevPage: base.page > 1, hasNextPage: base.page < base.pages, prevPage: null, nextPage: null, ...base };
}

/** 10 s à 10 i/s : trois pics nets (coupes) et un pic modéré qui n'apparaît qu'en sensibilité haute. */
function makeAnalysis(): ClipAnalysis {
  const diffs = Array.from({ length: 99 }, () => 0.02);
  for (const i of [19, 49, 79]) diffs[i] = 0.9;
  diffs[64] = 0.07;
  return {
    version: 2,
    durationSec: 10,
    fps: 10,
    cuts: [2, 5, 8],
    beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
    syncScore: 1.5,
    diffs,
    palette: Array.from({ length: 10 }, () => '#336699'),
    transitions: [2, 5, 8].map((time) => ({ time, kind: 'cut' as const })),
    thumbnailTimes: [0, 2.1, 5.1, 8.1],
    sensitivity: 3,
  };
}

const stats: LibraryStats = {
  clipCount: 3,
  totalDurationSec: 185,
  totalCuts: 40,
  avgShotLength: 4.2,
  mostNervous: makeClip('n1', 'Course'),
  mostSynced: makeClip('s1', 'Clip musical'),
  byVisibility: { private: 2, shared: 0, public: 1 },
};

function videoFile(name = 'extrait.mp4', type = 'video/mp4'): File {
  return new File(['octets-video'], name, { type });
}

describe('ClipsPageComponent', () => {
  let fixture: ComponentFixture<ClipsPageComponent>;
  let component: ClipsPageComponent;
  let service: Record<'list' | 'stats' | 'tags' | 'upload' | 'remove' | 'filmstrip', ReturnType<typeof vi.fn>>;
  let analyzer: { analyze: ReturnType<typeof vi.fn>; rebuild: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let dialog: { open: ReturnType<typeof vi.fn> };

  function setup(initial: Page<ClipSummary> = makePage([makeClip('c1')])) {
    service = {
      list: vi.fn(() => of(initial)),
      stats: vi.fn(() => of(stats)),
      tags: vi.fn(() => of([{ tag: 'action', count: 2 }, { tag: 'nuit', count: 1 }])),
      upload: vi.fn(),
      remove: vi.fn(),
      filmstrip: vi.fn(() => EMPTY),
    };
    analyzer = { analyze: vi.fn(), rebuild: vi.fn((analysis: ClipAnalysis, k: number) => rebuildAnalysis(analysis, k)) };
    snackBar = { open: vi.fn(() => ({ onAction: () => EMPTY })) };
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

  function result(analysis = makeAnalysis(), filmstrip: Blob | null = null): ClipAnalysisResult {
    return { analysis, filmstrip };
  }

  async function analyzed(file = videoFile(), analysis = makeAnalysis(), filmstrip: Blob | null = null) {
    analyzer.analyze.mockResolvedValue(result(analysis, filmstrip));
    component.selectFile(file);
    await vi.waitFor(() => expect(component.analysis()).not.toBeNull());
    fixture.detectChanges();
  }

  function confirmWith(value: boolean | undefined) {
    dialog.open.mockReturnValue({ afterClosed: () => of(value) });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('fonctions utilitaires', () => {
    it('valide MP4 et WebM (même sans type MIME), refuse les autres, les trop lourds et les vides', () => {
      expect(validateClipFile(videoFile())).toBeUndefined();
      expect(validateClipFile(videoFile('a.webm', ''))).toBeUndefined();
      expect(validateClipFile(videoFile('a.avi', 'video/x-msvideo'))).toContain('Format non accepté');
      const big = videoFile();
      Object.defineProperty(big, 'size', { value: MAX_CLIP_FILE_SIZE + 1 });
      expect(validateClipFile(big)).toContain('trop volumineux');
      expect(validateClipFile(new File([], 'vide.mp4', { type: 'video/mp4' }))).toContain('vide');
    });

    it('trace la courbe et la palette en direct', () => {
      expect(liveDiffPath([0, 0.5, 1], 100)).toBe('M0 40L1 20L2 0');
      expect(liveDiffPath([])).toBe('');
      const swatches = liveSwatches(Array.from({ length: 25 }, (_, i) => (i < 10 ? '#111111' : '#222222')), 100);
      expect(swatches).toEqual([
        { x: 0, width: 10, color: '#111111' },
        { x: 10, width: 10, color: '#222222' },
        { x: 20, width: 10, color: '#222222' },
      ]);
    });

    it('normalise les étiquettes', () => {
      expect(normalizeTag('  #Nuit ')).toBe('nuit');
    });
  });

  describe('tableau de bord', () => {
    it('affiche les statistiques et des puces vers le plus nerveux et le plus calé', () => {
      setup();
      expect(text('.stat-clips')).toBe('3');
      expect(text('.stat-total-duration')).toBe('03:05');
      expect(text('.stat-mean-shot')).toBe('4,2 s');
      expect(fixture.nativeElement.querySelector('.record-nervous').getAttribute('href')).toBe('/clips/n1');
      expect(fixture.nativeElement.querySelector('.record-synced').getAttribute('href')).toBe('/clips/s1');
    });
  });

  describe('import et analyse', () => {
    it('refuse un fichier invalide sans lancer l’analyse', () => {
      setup();
      component.selectFile(videoFile('a.mov', 'video/quicktime'));
      fixture.detectChanges();
      expect(text('#file-error')).toContain('MP4, WebM');
      expect(analyzer.analyze).not.toHaveBeenCalled();
    });

    it('montre la progression et l’aperçu en direct, puis le résultat', async () => {
      setup();
      let resolve!: (value: ClipAnalysisResult) => void;
      analyzer.analyze.mockImplementation((_file: File, options: ClipAnalyzeOptions) => {
        options.onProgress?.(0.42);
        for (let i = 0; i < 12; i++) options.onSample?.({ time: i / 10, diff: i === 5 ? 0.8 : 0.1, color: '#aa5500' });
        return new Promise<ClipAnalysisResult>((done) => (resolve = done));
      });

      component.selectFile(videoFile());
      await vi.waitFor(() => expect(component.liveSamples().length).toBe(12));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.analysis-progress').value).toBe(42);
      expect(fixture.nativeElement.querySelector('.live-line').getAttribute('d')).toMatch(/^M0 /);
      expect(fixture.nativeElement.querySelectorAll('.live-palette rect').length).toBe(2);
      expect(component.canUpload()).toBe(false);

      resolve(result());
      await vi.waitFor(() => expect(component.analyzing()).toBe(false));
      fixture.detectChanges();

      expect(text('.stat-cuts')).toBe('3');
      expect(text('.stat-asl')).toBe('2,5 s');
      expect(text('.stat-beats')).toBe('8');
      expect(text('.stat-sync')).toContain('calé sur la musique');
      expect(text('.stat-rhythm')).toBe('Soutenu');
      expect(text('.stat-tempo')).toContain('120 BPM');
      expect(text('.stat-tempo')).toContain('18,0 coupes/min');
      expect(fixture.nativeElement.querySelector('app-pulse-timeline')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-filmstrip')).not.toBeNull();
    });

    it('annule l’analyse en cours', async () => {
      setup();
      analyzer.analyze.mockImplementation(
        (_file: File, options: ClipAnalyzeOptions) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener('abort', () => reject(new ClipAnalysisError('aborted'))),
          ),
      );
      component.selectFile(videoFile());
      fixture.detectChanges();
      fixture.nativeElement.querySelector('.cancel').click();
      await vi.waitFor(() => expect(component.analyzing()).toBe(false));
      fixture.detectChanges();

      expect(component.analysis()).toBeNull();
      expect(component.analysisNotice()).toBe('Analyse annulée.');
      expect(component.analysisError()).toBe('');
      expect(component.canAnalyze()).toBe(true);
    });

    it('ignore un résultat arrivé après l’annulation sans créer d’ObjectURL', async () => {
      setup();
      const createSpy = vi.spyOn(URL, 'createObjectURL');
      analyzer.analyze.mockImplementation(
        (_file: File, options: ClipAnalyzeOptions) =>
          new Promise((resolve) =>
            options.signal?.addEventListener('abort', () => resolve(result(makeAnalysis(), new Blob(['jpeg'])))),
          ),
      );
      component.selectFile(videoFile());
      component.cancelAnalysis();
      await vi.waitFor(() => expect(component.analyzing()).toBe(false));

      expect(component.analysis()).toBeNull();
      expect(component.filmstripUrl()).toBe('');
      expect(createSpy).not.toHaveBeenCalled();
      expect(component.analysisNotice()).toBe('Analyse annulée.');
    });

    it('affiche une erreur d’analyse lisible', async () => {
      setup();
      analyzer.analyze.mockRejectedValue(new ClipAnalysisError('too-long'));
      component.selectFile(videoFile());
      await vi.waitFor(() => expect(component.analyzing()).toBe(false));
      fixture.detectChanges();
      expect(text('.analysis-error')).toContain('120 secondes');
    });

    it('recalcule localement les coupes avec le curseur de sensibilité', async () => {
      setup();
      await analyzed();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('#clip-sensitivity');
      expect(input.value).toBe('4');

      input.value = '6';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(analyzer.rebuild).toHaveBeenLastCalledWith(expect.objectContaining({ sensitivity: 3 }), 1);
      expect(component.sensitivity()).toBe(1);
      expect(component.analysis()?.cuts.length).toBeGreaterThan(3);
      expect(text('.stat-cuts')).toBe(String(component.analysis()?.cuts.length));

      component.setSensitivity(3);
      expect(component.analysis()?.cuts).toEqual([2, 5, 8]);
    });

    it('révoque l’ObjectURL de la pellicule au changement de fichier', async () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:strip');
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      setup();
      await analyzed(videoFile(), makeAnalysis(), new Blob(['jpeg']));
      expect(component.filmstripUrl()).toBe('blob:strip');

      analyzer.analyze.mockReturnValue(new Promise(() => undefined));
      component.selectFile(videoFile('autre.mp4'));
      expect(revoke).toHaveBeenCalledWith('blob:strip');
    });
  });

  describe('étiquettes', () => {
    it('ajoute avec Entrée ou virgule, normalise, dédoublonne et limite', async () => {
      setup();
      await analyzed();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('#clip-tag');

      component.tagDraft.setValue(' Nuit ');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      component.tagDraft.setValue('pluie,NUIT,');
      component.onTagInput();
      expect(component.tags()).toEqual(['nuit', 'pluie']);
      expect(component.tagDraft.value).toBe('');

      expect(component.addTag('x'.repeat(TAG_MAX_LENGTH + 1))).toBe(false);
      expect(component.tagMessage()).toContain(`${TAG_MAX_LENGTH} caractères`);

      for (const tag of ['a', 'b', 'c']) component.addTag(tag);
      expect(component.addTag('trop')).toBe(false);
      expect(component.tags().length).toBe(MAX_TAGS);

      component.removeTag('a');
      expect(component.tags()).not.toContain('a');
    });
  });

  describe('envoi', () => {
    it('envoie analyse réglée, pellicule, étiquettes et visibilité, puis rafraîchit la bibliothèque', async () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:strip');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      setup();
      const strip = new Blob(['jpeg'], { type: 'image/jpeg' });
      const file = videoFile();
      await analyzed(file, makeAnalysis(), strip);
      component.setSensitivity(2);
      const tuned = component.analysis();
      component.title.setValue('  Poursuite  ');
      component.addTag('action');
      component.tagDraft.setValue('nuit');
      component.visibility.setValue('public');

      const events = new Subject<unknown>();
      service.upload.mockReturnValue(events);
      service.list.mockClear();
      service.stats.mockClear();
      service.tags.mockClear();
      component.upload();

      expect(service.upload).toHaveBeenCalledWith(file, 'Poursuite', tuned, {
        filmstrip: strip,
        tags: ['action', 'nuit'],
        visibility: 'public',
      });
      events.next({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
      expect(component.uploadProgress()).toBe(50);

      const created = { ...makeClip('c9', 'Poursuite'), analysis: makeAnalysis(), annotations: [], sharedWith: [] } satisfies Clip;
      events.next(new HttpResponse({ body: created, status: 201 }));
      fixture.detectChanges();

      expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Poursuite'), 'Ouvrir', expect.anything());
      expect(fixture.nativeElement.querySelector('.created-link').getAttribute('href')).toBe('/clips/c9');
      expect(service.list).toHaveBeenCalledWith(1, 12, { q: '', tag: undefined, visibility: undefined });
      expect(service.stats).toHaveBeenCalled();
      expect(service.tags).toHaveBeenCalled();
      expect(component.file()).toBeUndefined();
      expect(component.tags()).toEqual([]);
      expect(component.visibility.value).toBe('private');
    });

    it('utilise le nom de fichier tronqué comme titre de repli et garde le formulaire en cas d’erreur', async () => {
      setup();
      const file = videoFile(`${'a'.repeat(TITLE_MAX_LENGTH + 10)}.mp4`);
      await analyzed(file);
      service.upload.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'Analyse invalide' } })));

      component.upload();
      fixture.detectChanges();

      expect(service.upload.mock.calls[0][1]).toBe('a'.repeat(TITLE_MAX_LENGTH));
      expect(text('.upload-error')).toBe('Analyse invalide');
      expect(component.analysis()).not.toBeNull();
    });
  });

  describe('bibliothèque', () => {
    it('filtre par texte avec anti-rebond', () => {
      vi.useFakeTimers();
      setup();
      service.list.mockClear();

      component.search.setValue('pou');
      component.search.setValue('poursuite');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(service.list).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(service.list).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledWith(1, 12, { q: 'poursuite', tag: undefined, visibility: undefined });
    });

    it('filtre par étiquette (bascule) et par visibilité', () => {
      setup();
      service.list.mockClear();
      const chip: HTMLButtonElement = fixture.nativeElement.querySelector('.tag-filter');
      chip.click();
      fixture.detectChanges();
      expect(service.list).toHaveBeenLastCalledWith(1, 12, { q: '', tag: 'action', visibility: undefined });
      expect(chip.getAttribute('aria-pressed')).toBe('true');

      component.setVisibilityFilter('public');
      expect(service.list).toHaveBeenLastCalledWith(1, 12, { q: '', tag: 'action', visibility: 'public' });

      chip.click();
      expect(service.list).toHaveBeenLastCalledWith(1, 12, { q: '', tag: undefined, visibility: 'public' });
    });

    it('affiche l’état vide filtré, l’erreur et réessaie', () => {
      setup(makePage([]));
      component.toggleTagFilter('action');
      fixture.detectChanges();
      expect(text('.empty-state')).toContain('Aucun extrait ne correspond');

      service.list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      component.load();
      fixture.detectChanges();
      expect(text('.list-error')).toContain('Serveur injoignable');
    });

    it('affiche des squelettes pendant le premier chargement', () => {
      setup();
      service.list.mockReturnValue(new Subject());
      component.clips.set([]);
      component.load();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.skeleton-card').length).toBeGreaterThan(0);
    });

    it('sélectionne deux cartes puis propose la comparaison', () => {
      setup(makePage([makeClip('a'), makeClip('b'), makeClip('c')]));
      const select = (index: number) => fixture.nativeElement.querySelectorAll('app-clip-card .select')[index].click();

      select(0);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('a.compare')).toBeNull();

      select(1);
      fixture.detectChanges();
      const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.compare');
      expect(link.getAttribute('href')).toBe('/clips/compare?a=a&b=b');

      select(2);
      expect(component.selection().map((clip) => clip.id)).toEqual(['b', 'c']);
      expect(component.announcement()).toContain('remplace');

      select(2);
      expect(component.selection().map((clip) => clip.id)).toEqual(['b']);
    });

    it('ouvre le détail d’un extrait', () => {
      setup();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fixture.nativeElement.querySelector('app-clip-card .open').click();
      expect(navigate).toHaveBeenCalledWith(['/clips', 'c1']);
    });

    it('supprime après confirmation, retire de la sélection et rafraîchit', () => {
      setup(makePage([makeClip('c1'), makeClip('c2')]));
      component.toggleSelect(component.clips()[0]);
      service.remove.mockReturnValue(of(undefined));
      service.stats.mockClear();
      confirmWith(true);

      fixture.nativeElement.querySelector('app-clip-card .delete').click();

      expect(dialog.open.mock.calls[0][1].data).toEqual({ title: 'Extrait c1', target: 'clip' });
      expect(service.remove).toHaveBeenCalledWith('c1');
      expect(component.selection()).toEqual([]);
      expect(service.stats).toHaveBeenCalled();
    });

    it('ne supprime rien si la confirmation est refusée', () => {
      setup();
      confirmWith(false);
      component.remove(component.clips()[0]);
      expect(service.remove).not.toHaveBeenCalled();
    });
  });
});
