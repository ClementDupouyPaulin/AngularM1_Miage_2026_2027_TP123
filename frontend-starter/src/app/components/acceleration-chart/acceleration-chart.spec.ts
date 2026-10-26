import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccelerationChartComponent } from './acceleration-chart';

describe('AccelerationChartComponent', () => {
  let fixture: ComponentFixture<AccelerationChartComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(AccelerationChartComponent);
    fixture.componentRef.setInput('cuts', [1, 2, 3, 15]);
    fixture.componentRef.setInput('durationSec', 20);
    fixture.componentRef.setInput('label', 'Clip A');
    fixture.detectChanges();
    root = fixture.nativeElement;
  });

  it('trace la courbe sur toute la durée avec graduations en code temporel', () => {
    const d = root.querySelector('path.line')?.getAttribute('d') ?? '';
    expect(d.startsWith('M0 8')).toBe(true);
    expect(d.split('L')).toHaveLength(21);
    expect(root.querySelector('path.line-compare')).toBeNull();
    expect(root.querySelector('.peak')?.textContent).toBe('3');
    expect(root.querySelector('.tick')?.textContent).toBe('00:00');
  });

  it('résume pic et moyenne dans l’aria-label', () => {
    const label = root.querySelector('figure')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('fenêtre glissante de 10 s');
    expect(label).toContain('Clip A : pic de 3 coupes à 00:00');
  });

  it('superpose une série de comparaison sur une échelle commune', () => {
    fixture.componentRef.setInput('compareCuts', [10, 11, 12, 13, 14, 30]);
    fixture.componentRef.setInput('compareDurationSec', 40);
    fixture.componentRef.setInput('compareLabel', 'Clip B');
    fixture.detectChanges();
    const main = root.querySelector('path.line')?.getAttribute('d') ?? '';
    expect(main.trim().endsWith('L500 123.2')).toBe(true);
    expect(root.querySelector('path.line-compare')).not.toBeNull();
    expect(root.querySelector('.peak')?.textContent).toBe('5');
    expect(root.querySelector('figure')?.getAttribute('aria-label')).toContain('; Clip B : pic de 5');
  });
});
