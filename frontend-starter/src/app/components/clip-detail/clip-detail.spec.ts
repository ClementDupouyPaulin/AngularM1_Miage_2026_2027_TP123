import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { Clip } from '../../shared/models/clip.model';
import { ClipService } from '../../shared/services/clip.service';
import { PulseTimelineComponent } from '../pulse-timeline/pulse-timeline';
import { ClipDetailComponent, interpretSyncScore, nextCut, previousCut } from './clip-detail';

describe('clip-detail : fonctions pures', () => {
  it('interprète le score de synchro', () => {
    expect(interpretSyncScore(null).verdict).toBe('Bande-son non analysable');
    expect(interpretSyncScore(1.02).verdict).toBe('Sans lien avec la musique');
    expect(interpretSyncScore(2.5)).toEqual({ value: '× 2,50', verdict: 'Calé sur la musique' });
  });

  it('trouve la coupe précédente (avec marge) et suivante', () => {
    const cuts = [5, 10, 20];
    expect(previousCut(cuts, 10.2)).toBe(5);
    expect(previousCut(cuts, 12)).toBe(10);
    expect(previousCut(cuts, 3)).toBeNull();
    expect(nextCut(cuts, 10)).toBe(20);
    expect(nextCut(cuts, 0)).toBe(5);
    expect(nextCut(cuts, 25)).toBeNull();
  });
});

describe('ClipDetailComponent', () => {
  const clip: Clip = {
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
    analysis: { version: 1, durationSec: 30, cuts: [5, 10, 20], beats: [1, 2, 3], syncScore: 1.8 },
  };

  let service: { get: ReturnType<typeof vi.fn>; video: ReturnType<typeof vi.fn> };
  let createSpy: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;
  let paramMap: BehaviorSubject<ParamMap>;
  const { createObjectURL, revokeObjectURL } = URL;

  function setup(get: Observable<Clip>, video: Observable<Blob> = of(new Blob(['v']))) {
    service.get.mockReturnValue(get);
    service.video.mockReturnValue(video);
    const fixture: ComponentFixture<ClipDetailComponent> = TestBed.createComponent(ClipDetailComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    service = { get: vi.fn(), video: vi.fn() };
    paramMap = new BehaviorSubject(convertToParamMap({ id: 'c1' }));
    createSpy = vi.fn<(obj: Blob | MediaSource) => string>(() => 'blob:clip-1');
    revokeSpy = vi.fn<(url: string) => void>();
    URL.createObjectURL = createSpy;
    URL.revokeObjectURL = revokeSpy;
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClipService, useValue: service },
        { provide: ActivatedRoute, useValue: { paramMap } },
      ],
    });
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
  });

  it('charge l’extrait puis la vidéo en ObjectURL', () => {
    const fixture = setup(of(clip));
    const root: HTMLElement = fixture.nativeElement;

    expect(service.get).toHaveBeenCalledWith('c1');
    expect(service.video).toHaveBeenCalledWith('c1');
    expect(root.querySelector('h1')?.textContent).toContain('Poursuite');
    expect(root.querySelector('video')?.getAttribute('src')).toBe('blob:clip-1');
    expect(root.querySelector('app-pulse-timeline')).not.toBeNull();
    expect(root.textContent).toContain('Calé sur la musique');
    expect(root.textContent).toContain('7,5 s');
    expect(root.querySelector('a[href="/clips"]')).not.toBeNull();
  });

  it('affiche « Extrait introuvable » sur un 404 sans charger la vidéo', () => {
    const fixture = setup(throwError(() => new HttpErrorResponse({ status: 404 })));
    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;

    expect(alert.textContent).toContain('Extrait introuvable');
    expect(service.video).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('garde l’analyse visible si seule la vidéo échoue', () => {
    const fixture = setup(of(clip), throwError(() => new HttpErrorResponse({ status: 500 })));
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('La vidéo est indisponible');
    expect(root.querySelector('app-pulse-timeline')).not.toBeNull();
  });

  it('révoque l’ObjectURL à la destruction', () => {
    const fixture = setup(of(clip));
    expect(revokeSpy).not.toHaveBeenCalled();

    fixture.destroy();
    expect(revokeSpy).toHaveBeenCalledWith('blob:clip-1');
  });

  it('recharge à chaque changement d’id en révoquant l’ObjectURL précédente', () => {
    const fixture = setup(of(clip));
    createSpy.mockReturnValue('blob:clip-2');
    service.get.mockReturnValue(of({ ...clip, id: 'c2', title: 'Fusillade' }));

    paramMap.next(convertToParamMap({ id: 'c2' }));
    fixture.detectChanges();

    expect(revokeSpy).toHaveBeenCalledWith('blob:clip-1');
    expect(service.get).toHaveBeenLastCalledWith('c2');
    expect(service.video).toHaveBeenLastCalledWith('c2');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Fusillade');
    expect(fixture.componentInstance.videoUrl()).toBe('blob:clip-2');
  });

  it('annule le chargement en cours quand l’id change', () => {
    const pendingVideo = new Subject<Blob>();
    const fixture = setup(of(clip), pendingVideo);
    service.video.mockReturnValue(of(new Blob(['v2'])));
    createSpy.mockReturnValue('blob:clip-2');

    paramMap.next(convertToParamMap({ id: 'c2' }));
    expect(pendingVideo.observed).toBe(false);
    pendingVideo.next(new Blob(['tardif']));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.videoUrl()).toBe('blob:clip-2');
  });

  it('affiche « Extrait introuvable » sans id', () => {
    paramMap.next(convertToParamMap({}));
    const fixture = setup(of(clip));

    expect(fixture.componentInstance.error()).toBe('Extrait introuvable.');
    expect(service.get).not.toHaveBeenCalled();
  });

  it('navigue entre coupes précédente et suivante', () => {
    const fixture = setup(of(clip));
    const component = fixture.componentInstance;

    component.goToNextCut();
    expect(component.currentTime()).toBe(5);
    component.goToNextCut();
    expect(component.currentTime()).toBe(10);

    component.seekTo(12);
    component.goToPreviousCut();
    expect(component.currentTime()).toBe(10);
    component.goToPreviousCut();
    expect(component.currentTime()).toBe(5);

    component.seekTo(25);
    fixture.detectChanges();
    const next = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Coupe suivante'));
    expect(next?.disabled).toBe(true);
  });

  it('applique le seek émis par la timeline', () => {
    const fixture = setup(of(clip));
    const timeline = fixture.debugElement.query((el) => el.componentInstance instanceof PulseTimelineComponent);

    (timeline.componentInstance as PulseTimelineComponent).seek.emit(17);
    expect(fixture.componentInstance.currentTime()).toBe(17);
  });
});
