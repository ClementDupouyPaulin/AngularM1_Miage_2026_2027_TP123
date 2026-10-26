import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClipAnalysis } from '../../shared/models/clip.model';
import { FilmstripComponent } from './filmstrip';

describe('FilmstripComponent', () => {
  const analysis: ClipAnalysis = {
    version: 2,
    durationSec: 30,
    fps: 10,
    cuts: [4, 12.5],
    beats: [],
    syncScore: null,
    diffs: [],
    palette: [],
    transitions: [
      { time: 4, kind: 'cut' },
      { time: 12.5, kind: 'cut' },
    ],
    thumbnailTimes: [0, 4, 12.5],
    sensitivity: 3,
  };

  let fixture: ComponentFixture<FilmstripComponent>;
  let root: HTMLElement;
  let seeks: number[];

  beforeEach(async () => {
    fixture = TestBed.createComponent(FilmstripComponent);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.componentRef.setInput('url', 'blob:sprite');
    fixture.componentRef.setInput('currentTime', 5);
    seeks = [];
    fixture.componentInstance.seek.subscribe((t) => seeks.push(t));
    await fixture.whenStable();
    root = fixture.nativeElement;
  });

  function cells(): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button.cell'));
  }

  it('rend une cellule bouton par vignette avec son temps et sa position dans le sprite', () => {
    expect(cells().length).toBe(3);
    expect(root.querySelector('ol')?.getAttribute('aria-label')).toBe('Pellicule : 3 plans');
    expect(cells()[2].getAttribute('aria-label')).toBe('Plan 3 à 00:12,5');
    expect(cells()[2].querySelector('.time')?.textContent).toBe('00:12,5');
    const frame = cells()[1].querySelector<HTMLElement>('.frame')!;
    expect(frame.style.backgroundPosition).toBe('-160px 0px');
    expect(frame.style.backgroundImage).toContain('blob:sprite');
  });

  it('met en évidence la cellule du plan en cours', async () => {
    expect(cells()[1].classList).toContain('active');
    expect(cells()[1].getAttribute('aria-current')).toBe('true');
    expect(cells()[0].hasAttribute('aria-current')).toBe(false);

    fixture.componentRef.setInput('currentTime', 13);
    await fixture.whenStable();
    expect(cells()[2].classList).toContain('active');
  });

  it('émet seek vers l’instant de la vignette cliquée', () => {
    cells()[2].click();
    cells()[0].click();
    expect(seeks).toEqual([12.5, 0]);
  });

  it('affiche un état vide sans vignette', async () => {
    fixture.componentRef.setInput('analysis', { ...analysis, thumbnailTimes: [] });
    await fixture.whenStable();
    expect(cells().length).toBe(0);
    expect(root.querySelector('.empty')?.textContent).toContain('Aucune vignette');
  });
});
