import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClipAnalysis, ClipAnnotation } from '../../shared/models/clip.model';
import { PulseTimelineComponent } from './pulse-timeline';

describe('PulseTimelineComponent', () => {
  const analysis: ClipAnalysis = {
    version: 2,
    durationSec: 60,
    fps: 10,
    cuts: [5, 12.4, 30],
    beats: [0.5, 1, 1.5, 2],
    syncScore: 1.4,
    diffs: [],
    palette: ['#112233', '#445566', '#778899'],
    transitions: [
      { time: 5, kind: 'cut' },
      { time: 12.4, kind: 'cut' },
      { time: 20, kind: 'fade' },
      { time: 30, kind: 'cut' },
    ],
    thumbnailTimes: [0, 5, 12.4, 30],
    sensitivity: 3,
  };

  const annotations: ClipAnnotation[] = [
    {
      id: 'a2',
      time: 40,
      text: 'Fin du dialogue',
      authorId: 'u1',
      authorName: 'Ada',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 'a1',
      time: 12,
      text: 'Raccord regard',
      authorId: 'u2',
      authorName: 'Bob',
      createdAt: '2026-10-01T09:00:00.000Z',
    },
  ];

  let fixture: ComponentFixture<PulseTimelineComponent>;
  let root: HTMLElement;
  let slider: HTMLElement;
  let seeks: number[];
  let annotates: number[];

  beforeEach(() => {
    fixture = TestBed.createComponent(PulseTimelineComponent);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.componentRef.setInput('currentTime', 10);
    fixture.componentRef.setInput('label', 'Pouls de « Démo »');
    seeks = [];
    annotates = [];
    fixture.componentInstance.seek.subscribe((t) => seeks.push(t));
    fixture.componentInstance.annotateAt.subscribe((t) => annotates.push(t));
    fixture.detectChanges();
    root = fixture.nativeElement;
    slider = root.querySelector('[role="slider"]')!;
  });

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    slider.dispatchEvent(event);
    return event;
  }

  function mockPlot(left: number, width: number): HTMLElement {
    const plot: HTMLElement = root.querySelector('.plot')!;
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(
      { left, width, top: 0, height: 100 } as DOMRect,
    );
    return plot;
  }

  it('expose un slider accessible en mm:ss', () => {
    expect(slider.getAttribute('tabindex')).toBe('0');
    expect(slider.getAttribute('aria-label')).toBe('Pouls de « Démo »');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('60');
    expect(slider.getAttribute('aria-valuenow')).toBe('10');
    expect(slider.getAttribute('aria-valuetext')).toBe('0:10 sur 1:00');
  });

  it('dessine coupes, fondus, beats, palette et graduations en code temporel', () => {
    expect(root.querySelectorAll('line.cut').length).toBe(3);
    expect(root.querySelectorAll('line.fade').length).toBe(1);
    expect(root.querySelector('line.fade')?.getAttribute('x1')).toBe('333.33');
    expect(root.querySelector('path.beats')?.getAttribute('d')).toContain('M8.33');
    expect(root.querySelector('path.pulse-line')?.getAttribute('d')).toMatch(/^M0 /);
    expect(root.querySelectorAll('linearGradient stop').length).toBe(3);
    expect(root.querySelector('.tick')?.textContent?.trim()).toBe('00:00');
  });

  it('masque beats et palette sur demande', () => {
    fixture.componentRef.setInput('showBeats', false);
    fixture.componentRef.setInput('showPalette', false);
    fixture.detectChanges();
    expect(root.querySelector('path.beats')).toBeNull();
    expect(root.querySelector('rect.palette')).toBeNull();
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1000 120');
  });

  it('émet seek au clavier (flèches, pages, Home, End) en restant borné', () => {
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    press('ArrowLeft');
    press('PageUp');
    press('PageDown');
    press('Home');
    press('End');
    expect(seeks).toEqual([11, 9, 20, 0, 0, 60]);

    fixture.componentRef.setInput('currentTime', 59.5);
    fixture.detectChanges();
    press('ArrowRight');
    expect(seeks.at(-1)).toBe(60);

    expect(press('a').defaultPrevented).toBe(false);
    expect(seeks.length).toBe(7);
  });

  it('émet annotateAt avec la touche N, sans seek', () => {
    expect(press('n').defaultPrevented).toBe(true);
    press('N', { shiftKey: true });
    press('n', { ctrlKey: true });
    expect(annotates).toEqual([10, 10]);
    expect(seeks).toEqual([]);
  });

  it('émet seek au clic, annotateAt au Maj+clic et au double-clic', () => {
    const plot = mockPlot(100, 400);
    plot.dispatchEvent(new MouseEvent('click', { clientX: 200, bubbles: true }));
    plot.dispatchEvent(new MouseEvent('click', { clientX: 300, shiftKey: true, bubbles: true }));
    plot.dispatchEvent(new MouseEvent('dblclick', { clientX: 400, bubbles: true }));
    expect(seeks).toEqual([15]);
    expect(annotates).toEqual([30, 45]);
  });

  it('s’aimante sur une coupe proche et affiche temps et vignette au survol', () => {
    fixture.componentRef.setInput('filmstripUrl', 'blob:sprite');
    const plot = mockPlot(0, 600);
    // 12,4 s sur 60 s × 600 px = 124 px ; 127 px reste dans la tolérance de 6 px.
    plot.dispatchEvent(new MouseEvent('mousemove', { clientX: 127, bubbles: true }));
    fixture.detectChanges();
    const tooltip = root.querySelector('.tooltip')!;
    expect(tooltip.textContent).toContain('Coupe 2');
    expect(tooltip.querySelector('.mono')?.textContent).toBe('00:12,4');
    const thumb = tooltip.querySelector<HTMLElement>('.thumb')!;
    expect(thumb.style.backgroundPosition).toBe('-320px 0px');
    expect(thumb.style.backgroundImage).toContain('blob:sprite');
    expect(root.querySelectorAll('line.cut.active').length).toBe(1);

    plot.dispatchEvent(new MouseEvent('click', { clientX: 127, bubbles: true }));
    expect(seeks).toEqual([12.4]);

    plot.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(root.querySelector('.tooltip')).toBeNull();
  });

  it('affiche l’infobulle de la position courante au focus, sans vignette sans sprite', () => {
    slider.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    const tooltip = root.querySelector('.tooltip')!;
    expect(tooltip.textContent).toContain('Position');
    expect(tooltip.textContent).toContain('00:10,0');
    expect(tooltip.querySelector('.thumb')).toBeNull();

    slider.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(root.querySelector('.tooltip')).toBeNull();
  });

  it('place des épingles d’annotation triées et accessibles qui émettent seek', () => {
    fixture.componentRef.setInput('annotations', annotations);
    fixture.detectChanges();
    const pins = root.querySelectorAll<HTMLButtonElement>('button.pin');
    expect(pins.length).toBe(2);
    expect(pins[0].getAttribute('aria-label')).toBe(
      'Annotation à 00:12,0 par Bob : Raccord regard',
    );
    expect(pins[1].closest<HTMLElement>('.pin-slot')?.style.left).toBe(`${(40 / 60) * 100}%`);
    expect(pins[1].querySelector('.pin-text')?.textContent).toContain('Fin du dialogue');
    pins[1].click();
    expect(seeks).toEqual([40]);
  });

  it('aligne l’échelle sur maxTime sans dépasser la durée de l’extrait', () => {
    fixture.componentRef.setInput('maxTime', 120);
    fixture.detectChanges();
    expect(root.querySelectorAll('line.cut')[2].getAttribute('x1')).toBe('250');
    expect(root.querySelector('rect.palette')?.getAttribute('width')).toBe('500');
    expect(root.querySelector<HTMLElement>('.cursor')?.style.left).toBe(`${(10 / 120) * 100}%`);
    expect(slider.getAttribute('aria-valuemax')).toBe('60');

    const plot = mockPlot(0, 400);
    plot.dispatchEvent(new MouseEvent('click', { clientX: 100, bubbles: true }));
    plot.dispatchEvent(new MouseEvent('click', { clientX: 300, bubbles: true }));
    expect(seeks).toEqual([30, 60]);
  });
});
