import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShotHistogramComponent } from './shot-histogram';

describe('ShotHistogramComponent', () => {
  let fixture: ComponentFixture<ShotHistogramComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(ShotHistogramComponent);
    // Plans : 0,5 · 1,5 · 3 · 5 · 10 s.
    fixture.componentRef.setInput('cuts', [0.5, 2, 5, 10]);
    fixture.componentRef.setInput('durationSec', 20);
    fixture.componentRef.setInput('label', 'Clip A');
    fixture.detectChanges();
    root = fixture.nativeElement;
  });

  it('dessine cinq classes avec leurs effectifs lisibles', () => {
    expect(root.querySelectorAll('rect.bar').length).toBe(5);
    expect(Array.from(root.querySelectorAll('text.bin-label')).map((t) => t.textContent)).toEqual([
      '0–1 s',
      '1–2 s',
      '2–4 s',
      '4–8 s',
      '8 s +',
    ]);
    expect(Array.from(root.querySelectorAll('text.value')).map((t) => t.textContent)).toEqual([
      '1',
      '1',
      '1',
      '1',
      '1',
    ]);
    expect(root.querySelector('rect.bar-compare')).toBeNull();
  });

  it('résume la répartition dans l’aria-label', () => {
    const figure = root.querySelector('figure')!;
    expect(figure.getAttribute('role')).toBe('img');
    expect(figure.getAttribute('aria-label')).toBe(
      'Clip A : 0–1 s : 1 plan, 1–2 s : 1 plan, 2–4 s : 1 plan, 4–8 s : 1 plan, 8 s + : 1 plan',
    );
  });

  it('superpose une série de comparaison', () => {
    fixture.componentRef.setInput('compareCuts', [0.2, 0.4, 0.6]);
    fixture.componentRef.setInput('compareDurationSec', 0.8);
    fixture.componentRef.setInput('compareLabel', 'Clip B');
    fixture.detectChanges();
    expect(root.querySelectorAll('rect.bar-compare').length).toBe(5);
    expect(root.querySelector('text.value')?.textContent).toBe('1 / 4');
    // Toutes les durées de B sont < 1 s : sa barre atteint le sommet de l'échelle.
    const tallest = root.querySelectorAll('rect.bar-compare')[0];
    expect(tallest.getAttribute('height')).toBe('152');
    expect(root.querySelector('figure')?.getAttribute('aria-label')).toContain(
      '; Clip B : 0–1 s : 4 plans',
    );
  });
});
