import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SparklineComponent } from './sparkline';

describe('SparklineComponent', () => {
  let fixture: ComponentFixture<SparklineComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(SparklineComponent);
    fixture.componentRef.setInput('values', [0, 2, 4]);
    fixture.detectChanges();
    host = fixture.nativeElement;
  });

  it('trace une mini-courbe normalisée', () => {
    expect(host.querySelector('path.line')?.getAttribute('d')).toBe('M0 28 L50 15 L100 2');
    expect(host.getAttribute('data-tone')).toBe('steady');
  });

  it('est décorative sans libellé et décrite avec', () => {
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('role')).toBe(false);

    fixture.componentRef.setInput('label', 'Rythme soutenu');
    fixture.componentRef.setInput('tone', 'intense');
    fixture.detectChanges();
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Rythme soutenu');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
    expect(host.getAttribute('data-tone')).toBe('intense');
  });

  it('ne trace rien sans valeur', () => {
    fixture.componentRef.setInput('values', []);
    fixture.detectChanges();
    expect(host.querySelector('path.line')).toBeNull();
  });
});
