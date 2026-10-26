import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { Clip, ClipAnalysis, ClipAnnotation } from '../../shared/models/clip.model';
import { User } from '../../shared/models/user.model';
import { AuthService } from '../../shared/services/auth.service';
import { ClipAnalyzerService } from '../../shared/services/clip-analyzer.service';
import { ClipService } from '../../shared/services/clip.service';
import { PulseTimelineComponent } from '../pulse-timeline/pulse-timeline';
import { ShareDialogComponent } from '../share-dialog/share-dialog';
import { ConfirmDeleteDialogComponent } from '../tracks-page/confirm-delete-dialog/confirm-delete-dialog';
import { ClipDetailComponent } from './clip-detail';

const ANALYSIS: ClipAnalysis = {
  version: 2,
  durationSec: 30,
  fps: 10,
  cuts: [5, 10, 20],
  beats: [1, 2, 3, 4, 5],
  syncScore: 1.8,
  diffs: [0.1, 0.8, 0.1],
  palette: ['#112233', '#445566'],
  transitions: [
    { time: 5, kind: 'cut' },
    { time: 8, kind: 'fade' },
    { time: 10, kind: 'cut' },
    { time: 20, kind: 'cut' },
  ],
  thumbnailTimes: [0, 5, 10, 20],
  sensitivity: 3,
};

function annotation(id: string, time: number, authorId = 'u1'): ClipAnnotation {
  return { id, time, text: `Note ${id}`, authorId, authorName: authorId === 'u1' ? 'Moi' : 'Alice', createdAt: '2026-10-01' };
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    title: 'Poursuite',
    originalName: 'poursuite.mp4',
    mimeType: 'video/mp4',
    size: 1024,
    durationSec: 30,
    cutCount: 3,
    avgShotLength: 7.5,
    syncScore: 1.8,
    createdAt: '2026-10-01T10:00:00.000Z',
    tags: ['action'],
    visibility: 'private',
    owner: { id: 'u1', name: 'Moi' },
    isOwner: true,
    hasFilmstrip: false,
    sparkline: [],
    analysis: ANALYSIS,
    annotations: [],
    sharedWith: [],
    ...overrides,
  };
}

describe('ClipDetailComponent', () => {
  type Mock = ReturnType<typeof vi.fn>;
  let service: Record<
    'get' | 'video' | 'filmstrip' | 'patch' | 'updateAnalysis' | 'remove' | 'addAnnotation' | 'removeAnnotation',
    Mock
  >;
  let analyzer: { rebuild: Mock };
  let dialog: { open: Mock };
  let currentUser: ReturnType<typeof signal<User | null>>;
  let paramMap: BehaviorSubject<ParamMap>;
  let createSpy: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;
  const { createObjectURL, revokeObjectURL } = URL;

  function setup(get: Observable<Clip> = of(makeClip())) {
    service.get.mockReturnValue(get);
    const fixture: ComponentFixture<ClipDetailComponent> = TestBed.createComponent(ClipDetailComponent);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
  }

  function text(root: HTMLElement): string {
    return root.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function dialogClosingWith(value: unknown) {
    dialog.open.mockReturnValue({ afterClosed: () => of(value) });
  }

  beforeEach(() => {
    service = {
      get: vi.fn(),
      video: vi.fn(() => of(new Blob(['v']))),
      filmstrip: vi.fn(() => of(new Blob(['f']))),
      patch: vi.fn(),
      updateAnalysis: vi.fn(),
      remove: vi.fn(() => of(undefined)),
      addAnnotation: vi.fn(),
      removeAnnotation: vi.fn(() => of(undefined)),
    };
    analyzer = { rebuild: vi.fn() };
    dialog = { open: vi.fn() };
    currentUser = signal<User | null>({ id: 'u1', name: 'Moi', email: 'moi@example.com', createdAt: '' });
    paramMap = new BehaviorSubject(convertToParamMap({ id: 'c1' }));
    let counter = 0;
    createSpy = vi.fn<(obj: Blob | MediaSource) => string>(() => `blob:url-${++counter}`);
    revokeSpy = vi.fn<(url: string) => void>();
    URL.createObjectURL = createSpy;
    URL.revokeObjectURL = revokeSpy;
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClipService, useValue: service },
        { provide: ClipAnalyzerService, useValue: analyzer },
        { provide: AuthService, useValue: { currentUser } },
        { provide: MatDialog, useValue: dialog },
        { provide: ActivatedRoute, useValue: { paramMap } },
      ],
    });
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
  });

  describe('chargement', () => {
    it('affiche le lecteur, la timeline et les mesures', () => {
      const { root, fixture } = setup();
      expect(service.get).toHaveBeenCalledWith('c1');
      expect(root.querySelector('h1')?.textContent).toContain('Poursuite');
      expect(root.querySelector('app-video-player video')?.getAttribute('src')).toBe('blob:url-1');
      expect(fixture.debugElement.query((el) => el.componentInstance instanceof PulseTimelineComponent)).toBeTruthy();
      expect(root.querySelector('app-filmstrip')).toBeTruthy();
      expect(root.querySelector('app-palette-band')).toBeTruthy();
      expect(root.querySelector('app-shot-histogram')).toBeTruthy();
      expect(root.querySelector('app-acceleration-chart')).toBeTruthy();
      const cards = new Map(
        Array.from(root.querySelectorAll('.stat-card')).map((card) => [
          card.querySelector('dt')?.textContent?.trim(),
          card.querySelector('.stat-value')?.textContent?.trim(),
        ]),
      );
      expect(cards.get('Fondus')).toBe('1');
      expect(cards.get('Coupes / minute')).toBe('6,0');
      expect(cards.get('Plan médian')).toBe('7,5 s');
      expect(cards.get('Tempo musique')).toBe('120 BPM');
      expect(text(root)).toContain('Calé sur la musique');
      expect(service.filmstrip).not.toHaveBeenCalled();
    });

    it('charge la pellicule si elle existe et révoque les ObjectURL à la destruction', () => {
      const { fixture, component } = setup(of(makeClip({ hasFilmstrip: true })));
      expect(service.filmstrip).toHaveBeenCalledWith('c1');
      expect(component.filmstripUrl()).toBe('blob:url-2');
      fixture.destroy();
      expect(revokeSpy).toHaveBeenCalledWith('blob:url-1');
      expect(revokeSpy).toHaveBeenCalledWith('blob:url-2');
    });

    it('recharge au changement d’identifiant en révoquant l’ancienne vidéo', () => {
      const { component } = setup();
      service.get.mockReturnValue(of(makeClip({ id: 'c2' })));
      paramMap.next(convertToParamMap({ id: 'c2' }));
      expect(service.video).toHaveBeenLastCalledWith('c2');
      expect(revokeSpy).toHaveBeenCalledWith('blob:url-1');
      expect(component.videoUrl()).toBe('blob:url-2');
    });
  });

  describe('erreurs', () => {
    it('affiche un 404 sans charger la vidéo', () => {
      const { root } = setup(throwError(() => new HttpErrorResponse({ status: 404 })));
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('ne vous est pas partagé');
      expect(service.video).not.toHaveBeenCalled();
    });

    it('affiche une session expirée sur 401', () => {
      const { root } = setup(throwError(() => new HttpErrorResponse({ status: 401 })));
      expect(root.querySelector('[role="alert"]')?.textContent).toContain('Session expirée');
    });

    it('garde l’analyse si la vidéo manque', () => {
      service.video.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      const { root } = setup();
      expect(root.querySelector('app-video-player')).toBeNull();
      expect(text(root)).toContain('Le fichier vidéo est introuvable');
      expect(root.querySelector('app-pulse-timeline')).toBeTruthy();
    });
  });

  describe('sensibilité', () => {
    const rebuilt: ClipAnalysis = { ...ANALYSIS, cuts: [10], transitions: [{ time: 10, kind: 'cut' }], sensitivity: 5 };

    function slide(root: HTMLElement, value: string) {
      const range = root.querySelector('#sensitivity') as HTMLInputElement;
      range.value = value;
      range.dispatchEvent(new Event('input'));
    }

    it('re-détecte localement et prévisualise les mesures', () => {
      analyzer.rebuild.mockReturnValue(rebuilt);
      const { root, fixture, component } = setup();
      slide(root, '5');
      fixture.detectChanges();
      expect(analyzer.rebuild).toHaveBeenCalledWith(ANALYSIS, 5);
      expect(component.analysis()).toBe(rebuilt);
      expect(text(root.querySelector('.preview-status') as HTMLElement)).toContain('1 coupes, 0 fondus');
      expect(text(root)).toContain('aperçu non enregistré');
    });

    it('enregistre le réglage du propriétaire', () => {
      analyzer.rebuild.mockReturnValue(rebuilt);
      service.updateAnalysis.mockReturnValue(of(makeClip({ analysis: rebuilt, cutCount: 1 })));
      const { root, fixture, component } = setup();
      slide(root, '5');
      fixture.detectChanges();
      (root.querySelector('.save-analysis') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(service.updateAnalysis).toHaveBeenCalledWith('c1', rebuilt);
      expect(component.dirty()).toBe(false);
      expect(component.sensitivity()).toBe(5);
      expect(text(root)).toContain('Analyse enregistrée : 1 coupes.');
    });

    it('réinitialise l’aperçu', () => {
      analyzer.rebuild.mockReturnValue(rebuilt);
      const { root, fixture, component } = setup();
      slide(root, '5');
      component.resetAnalysis();
      fixture.detectChanges();
      expect(component.analysis()).toBe(ANALYSIS);
      expect(component.sensitivity()).toBe(3);
    });

    it('signale un échec d’enregistrement', () => {
      analyzer.rebuild.mockReturnValue(rebuilt);
      service.updateAnalysis.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { root, fixture, component } = setup();
      slide(root, '5');
      component.saveAnalysis();
      fixture.detectChanges();
      expect(component.dirty()).toBe(true);
      expect(text(root)).toContain('L’analyse n’a pas pu être enregistrée.');
    });
  });

  describe('propriétaire contre lecteur', () => {
    it('montre les actions du propriétaire', () => {
      const { root } = setup();
      expect(root.querySelector('[data-testid="owner-badge"]')?.textContent).toContain('Propriétaire');
      expect(root.querySelector('[data-testid="visibility-badge"]')?.textContent).toContain('Privé');
      expect(root.querySelector('.share-button')).toBeTruthy();
      expect(root.querySelector('.delete-button')).toBeTruthy();
      expect(root.querySelector('.save-analysis')).toBeTruthy();
    });

    it('laisse un lecteur explorer sans enregistrer ni administrer', () => {
      analyzer.rebuild.mockReturnValue({ ...ANALYSIS, cuts: [], sensitivity: 6 });
      currentUser.set({ id: 'u2', name: 'Bob', email: 'bob@example.com', createdAt: '' });
      const clip = makeClip({ isOwner: false, owner: { id: 'u9', name: 'Alice' }, visibility: 'public' });
      const { root, fixture, component } = setup(of(clip));
      expect(root.querySelector('[data-testid="owner-badge"]')?.textContent).toContain('Partagé par Alice');
      expect(root.querySelector('.share-button')).toBeNull();
      expect(root.querySelector('.delete-button')).toBeNull();
      expect(root.querySelector('.save-analysis')).toBeNull();
      component.onSensitivityInput(6);
      fixture.detectChanges();
      expect(analyzer.rebuild).toHaveBeenCalled();
      expect(text(root)).toContain('Exploration locale');
      component.saveAnalysis();
      expect(service.updateAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('annotations', () => {
    it('liste les annotations triées et saute à leur instant', () => {
      const { root, component } = setup(of(makeClip({ annotations: [annotation('b', 12), annotation('a', 3)] })));
      const items = Array.from(root.querySelectorAll('.annotation-text')).map((item) => item.textContent);
      expect(items).toEqual(['Note a', 'Note b']);
      (root.querySelector('.annotation-jump') as HTMLButtonElement).click();
      expect(component.currentTime()).toBe(3);
    });

    it('ajoute une annotation au temps choisi sur la timeline', () => {
      service.addAnnotation.mockReturnValue(of(annotation('n', 7.5)));
      const { root, fixture, component } = setup();
      component.onAnnotateAt(7.56);
      component.annotationText.setValue('  Raccord regard  ');
      (root.querySelector('.annotation-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect(service.addAnnotation).toHaveBeenCalledWith('c1', { time: 7.5, text: 'Raccord regard' });
      expect(root.querySelectorAll('.annotation')).toHaveLength(1);
      expect(component.annotationText.value).toBe('');
      expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain('Annotation ajoutée à 00:07,5');
    });

    it('refuse un texte vide ou trop long', () => {
      const { component } = setup();
      component.addAnnotation();
      component.annotationText.setValue('x'.repeat(281));
      component.addAnnotation();
      expect(service.addAnnotation).not.toHaveBeenCalled();
      expect(component.annotationError()).toContain('280');
    });

    it('ne propose la suppression qu’à l’auteur ou au propriétaire', () => {
      currentUser.set({ id: 'u2', name: 'Bob', email: 'bob@example.com', createdAt: '' });
      const clip = makeClip({
        isOwner: false,
        owner: { id: 'u9', name: 'Alice' },
        annotations: [annotation('mine', 2, 'u2'), annotation('other', 4, 'u9')],
      });
      const { root, fixture } = setup(of(clip));
      const buttons = root.querySelectorAll('.remove-annotation');
      expect(buttons).toHaveLength(1);
      (buttons[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(service.removeAnnotation).toHaveBeenCalledWith('c1', 'mine');
      expect(root.querySelectorAll('.annotation')).toHaveLength(1);
      expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain('supprimée');
    });
  });

  describe('métadonnées, partage et suppression', () => {
    it('modifie le titre et les étiquettes', () => {
      service.patch.mockReturnValue(of(makeClip({ title: 'Nouveau', tags: ['nuit', 'pluie'] })));
      const { root, fixture, component } = setup();
      component.startEditing();
      component.metaForm.setValue({ title: ' Nouveau ', tags: 'Nuit, pluie' });
      component.saveMetadata();
      fixture.detectChanges();
      expect(service.patch).toHaveBeenCalledWith('c1', { title: 'Nouveau', tags: ['nuit', 'pluie'] });
      expect(root.querySelector('h1')?.textContent).toContain('Nouveau');
      expect(component.editing()).toBe(false);
    });

    it('refuse plus de 5 étiquettes', () => {
      const { component } = setup();
      component.startEditing();
      component.metaForm.controls.tags.setValue('a, b, c, d, e, f');
      component.saveMetadata();
      expect(service.patch).not.toHaveBeenCalled();
      expect(component.metaError()).toContain('5 étiquettes');
    });

    it('applique l’extrait renvoyé par le dialogue de partage', () => {
      dialogClosingWith(makeClip({ visibility: 'shared', sharedWith: [{ id: 'u2', name: 'Alice' }] }));
      const { root, fixture } = setup();
      (root.querySelector('.share-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(dialog.open).toHaveBeenCalledWith(ShareDialogComponent, expect.objectContaining({ data: { clip: expect.any(Object) } }));
      expect(root.querySelector('[data-testid="visibility-badge"]')?.textContent).toContain('Partagé avec des amis (1 ami)');
    });

    it('supprime après confirmation et revient au Studio', () => {
      dialogClosingWith(true);
      const { root } = setup();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      (root.querySelector('.delete-button') as HTMLButtonElement).click();
      expect(dialog.open).toHaveBeenCalledWith(
        ConfirmDeleteDialogComponent,
        expect.objectContaining({ data: { title: 'Poursuite', target: 'clip' } }),
      );
      expect(service.remove).toHaveBeenCalledWith('c1');
      expect(navigate).toHaveBeenCalledWith(['/clips']);
    });

    it('ne supprime rien si la confirmation est annulée', () => {
      dialogClosingWith(false);
      const { component } = setup();
      component.confirmDelete();
      expect(service.remove).not.toHaveBeenCalled();
    });
  });

  describe('export', () => {
    let click: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });

    it('télécharge l’analyse en JSON', () => {
      const { component } = setup();
      createSpy.mockClear();
      component.exportJson();
      expect(createSpy).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalled();
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('poursuite-analyse.json');
      expect(component.exportMessage()).toContain('téléchargées');
    });

    it('dessine puis télécharge l’image du pouls', () => {
      const context = {
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'])));
      const { component } = setup();
      component.exportPng();
      expect(context.fillText).toHaveBeenCalledWith('Poursuite', expect.any(Number), expect.any(Number));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('poursuite-pouls.png');
      expect(component.exportMessage()).toBe('Image du pouls téléchargée.');
    });

    it('prévient si le canvas est indisponible', () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      const { component } = setup();
      component.exportPng();
      expect(click).not.toHaveBeenCalled();
      expect(component.exportMessage()).toContain('ne permet pas');
    });
  });
});
