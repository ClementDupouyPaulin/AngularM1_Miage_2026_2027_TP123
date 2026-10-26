import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClipAnalysis } from '../../shared/models/clip.model';
import {
  PulseTimelineComponent,
  axisTicks,
  cutDensity,
  formatPreciseTime,
  formatTime,
  pulsePoints,
  ratioToTime,
  smooth,
  timeToRatio,
} from './pulse-timeline';

describe('pulse-timeline : fonctions pures', () => {
  it('convertit temps et position relative en restant borné', () => {
    expect(timeToRatio(30, 120)).toBe(0.25);
    expect(timeToRatio(-5, 120)).toBe(0);
    expect(timeToRatio(500, 120)).toBe(1);
    expect(timeToRatio(10, 0)).toBe(0);
    expect(ratioToTime(0.5, 90)).toBe(45);
    expect(ratioToTime(1.4, 90)).toBe(90);
    expect(ratioToTime(0.5, Number.NaN)).toBe(0);
  });

  it('formate les temps en m:ss et m:ss,d', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatPreciseTime(12.44)).toBe('0:12,4');
    expect(formatPreciseTime(59.96)).toBe('1:00,0');
  });

  it('compte les coupes dans une fenêtre glissante de 5 s', () => {
    const density = cutDensity([1, 2, 3, 20], 20, 4);
    // Échantillons à 0, 5, 10, 15 et 20 s ; fenêtre [t - 2,5 ; t + 2,5[.
    expect(density).toEqual([2, 1, 0, 0, 1]);
    expect(cutDensity([], 10, 2)).toEqual([0, 0, 0]);
    expect(cutDensity([1], 0)).toEqual([]);
  });

  it('lisse par moyenne glissante tronquée aux bords', () => {
    expect(smooth([0, 3, 0], 1)).toEqual([1.5, 1, 1.5]);
    expect(smooth([1, 2], 0)).toEqual([1, 2]);
  });

  it('place les points du pouls dans la bande verticale', () => {
    expect(pulsePoints([0, 2, 4], 4, 100, 0, 50)).toEqual([
      [0, 50],
      [50, 25],
      [100, 0],
    ]);
    expect(pulsePoints([], 1)).toEqual([]);
  });

  it('choisit un pas de graduation rond', () => {
    expect(axisTicks(60)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(axisTicks(7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(axisTicks(0)).toEqual([0]);
  });
});

describe('PulseTimelineComponent', () => {
  const analysis: ClipAnalysis = {
    version: 1,
    durationSec: 60,
    cuts: [5, 12.4, 30],
    beats: [0.5, 1, 1.5, 2],
    syncScore: 1.4,
  };

  let fixture: ComponentFixture<PulseTimelineComponent>;
  let slider: HTMLElement;
  let seeks: number[];

  beforeEach(() => {
    fixture = TestBed.createComponent(PulseTimelineComponent);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.componentRef.setInput('currentTime', 10);
    fixture.componentRef.setInput('label', 'Pouls de « Démo »');
    seeks = [];
    fixture.componentInstance.seek.subscribe((t) => seeks.push(t));
    fixture.detectChanges();
    slider = fixture.nativeElement.querySelector('[role="slider"]');
  });

  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    slider.dispatchEvent(event);
    return event;
  }

  it('expose un slider accessible en mm:ss', () => {
    expect(slider.getAttribute('tabindex')).toBe('0');
    expect(slider.getAttribute('aria-label')).toBe('Pouls de « Démo »');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('60');
    expect(slider.getAttribute('aria-valuenow')).toBe('10');
    expect(slider.getAttribute('aria-valuetext')).toBe('0:10 sur 1:00');
  });

  it('dessine un pic par coupe et la bande des beats', () => {
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('line.cut').length).toBe(3);
    expect(root.querySelector('path.beats')?.getAttribute('d')).toContain('M8.33');
    expect(root.querySelector('path.pulse-line')?.getAttribute('d')).toMatch(/^M0 /);
  });

  it('émet seek au clavier (flèches, Home, End) en restant borné', () => {
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    press('ArrowLeft');
    press('Home');
    press('End');
    expect(seeks).toEqual([11, 9, 0, 60]);

    fixture.componentRef.setInput('currentTime', 59.5);
    fixture.detectChanges();
    press('ArrowRight');
    expect(seeks.at(-1)).toBe(60);

    expect(press('a').defaultPrevented).toBe(false);
    expect(seeks.length).toBe(5);
  });

  it('émet seek au clic selon la position horizontale', () => {
    const plot: HTMLElement = fixture.nativeElement.querySelector('.plot');
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(
      { left: 100, width: 400, top: 0, height: 100 } as DOMRect,
    );
    plot.dispatchEvent(new MouseEvent('click', { clientX: 200, bubbles: true }));
    expect(seeks).toEqual([15]);
  });

  it('saute exactement à une coupe cliquée et affiche son temps au survol', () => {
    const hit = fixture.nativeElement.querySelectorAll('rect.cut-hit')[1] as SVGElement;
    hit.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tooltip')?.textContent).toContain(
      'Coupe 2 · 0:12,4',
    );

    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(seeks).toEqual([12.4]);
  });
});
