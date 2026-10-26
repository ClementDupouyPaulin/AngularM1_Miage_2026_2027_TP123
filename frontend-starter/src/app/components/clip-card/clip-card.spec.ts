import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ClipSummary } from '../../shared/models/clip.model';
import { ClipService } from '../../shared/services/clip.service';
import { ClipCardComponent } from './clip-card';
import { formatDuration, syncScoreLabel } from './clip-format';

function makeSummary(id: string, overrides: Partial<ClipSummary> = {}): ClipSummary {
  return {
    id,
    title: `Extrait ${id}`,
    originalName: `${id}.mp4`,
    mimeType: 'video/mp4',
    size: 2048,
    durationSec: 75,
    cutCount: 30,
    avgShotLength: 2.5,
    syncScore: 1.6,
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: ['action'],
    visibility: 'private',
    owner: { id: 'u1', name: 'Alice' },
    isOwner: true,
    hasFilmstrip: true,
    sparkline: [0, 1, 2, 1],
    ...overrides,
  };
}

describe('ClipCardComponent', () => {
  let fixture: ComponentFixture<ClipCardComponent>;
  let service: { filmstrip: ReturnType<typeof vi.fn> };

  function setup(clip: ClipSummary, inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      imports: [ClipCardComponent],
      providers: [{ provide: ClipService, useValue: service }],
    });
    fixture = TestBed.createComponent(ClipCardComponent);
    fixture.componentRef.setInput('clip', clip);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  beforeEach(() => {
    service = { filmstrip: vi.fn(() => of(new Blob(['jpeg'], { type: 'image/jpeg' }))) };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:poster');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('formate durée et synchro', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(syncScoreLabel(null)).toBe('bande-son non analysable');
    expect(syncScoreLabel(1)).toBe('sans lien avec la musique');
    expect(syncScoreLabel(2.4)).toBe('calé sur la musique');
  });

  it('affiche la première cellule de la pellicule puis révoque l’ObjectURL à la destruction', () => {
    setup(makeSummary('c1'));

    expect(service.filmstrip).toHaveBeenCalledWith('c1');
    expect(el('.poster-img')?.getAttribute('src')).toBe('blob:poster');
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster');
  });

  it('ne recharge pas l’affiche pour une nouvelle référence du même clip', () => {
    setup(makeSummary('c1'));
    fixture.componentRef.setInput('clip', makeSummary('c1', { title: 'Renommé' }));
    fixture.detectChanges();

    expect(service.filmstrip).toHaveBeenCalledTimes(1);
  });

  it('se replie sur un dégradé sans pellicule ou en cas d’erreur', () => {
    setup(makeSummary('c1', { hasFilmstrip: false }));
    expect(service.filmstrip).not.toHaveBeenCalled();
    expect(el('.poster-fallback')).not.toBeNull();

    TestBed.resetTestingModule();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    service.filmstrip.mockReturnValue(throwError(() => new Error('404')));
    setup(makeSummary('c2'));
    expect(el('.poster-fallback')).not.toBeNull();
  });

  it('annule le chargement en cours à la destruction', () => {
    const pending = new Subject<Blob>();
    service.filmstrip.mockReturnValue(pending);
    setup(makeSummary('c1'));
    fixture.destroy();

    expect(pending.observed).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('affiche code temporel, rythme, synchro, étiquettes et visibilité accessible', () => {
    setup(makeSummary('c1', { visibility: 'public' }));
    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');

    expect(el('.duration')?.textContent).toContain('01:15');
    expect(el('.rhythm')?.textContent?.trim()).toBe('Soutenu');
    expect(el('.rhythm')?.getAttribute('data-tone')).toBe('brisk');
    expect(text).toContain('Synchro calé sur la musique');
    expect(text).toContain('#action');
    expect(el('.visibility')?.textContent).toContain('Visibilité : Public');
    expect(el('app-sparkline')?.getAttribute('data-tone')).toBe('brisk');
    expect(el('.owner')).toBeNull();
  });

  it('considère un clip sans coupe comme contemplatif et montre le propriétaire si demandé', () => {
    setup(makeSummary('c1', { cutCount: 0, avgShotLength: 3 }), { showOwner: true });

    expect(el('.rhythm')?.textContent?.trim()).toBe('Contemplatif');
    expect(el('.owner')?.textContent).toContain('Alice');
  });

  it('émet open, toggleSelect et remove', () => {
    setup(makeSummary('c1'), { selectable: true, deletable: true, selected: true });
    const clip = fixture.componentInstance.clip();
    const opened = vi.fn();
    const toggled = vi.fn();
    const removed = vi.fn();
    fixture.componentInstance.open.subscribe(opened);
    fixture.componentInstance.toggleSelect.subscribe(toggled);
    fixture.componentInstance.remove.subscribe(removed);

    el('.open')?.click();
    el('.select')?.click();
    el('.delete')?.click();

    expect(opened).toHaveBeenCalledWith(clip);
    expect(toggled).toHaveBeenCalledWith(clip);
    expect(removed).toHaveBeenCalledWith(clip);
    expect(el('.select')?.getAttribute('aria-pressed')).toBe('true');
    expect(el('.delete')?.getAttribute('aria-label')).toBe('Supprimer « Extrait c1 »');
  });

  it('masque les actions par défaut', () => {
    setup(makeSummary('c1'));
    expect(el('.select')).toBeNull();
    expect(el('.delete')).toBeNull();
  });
});
