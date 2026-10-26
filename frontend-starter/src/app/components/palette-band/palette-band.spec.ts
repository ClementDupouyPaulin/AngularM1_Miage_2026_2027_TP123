import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaletteBandComponent } from './palette-band';

describe('PaletteBandComponent', () => {
  let fixture: ComponentFixture<PaletteBandComponent>;
  let band: HTMLElement;
  let seeks: number[];

  beforeEach(() => {
    fixture = TestBed.createComponent(PaletteBandComponent);
    fixture.componentRef.setInput('palette', ['#000000', '#808080', 'oops', '#ffffff']);
    fixture.componentRef.setInput('durationSec', 40);
    fixture.componentRef.setInput('currentTime', 10);
    seeks = [];
    fixture.componentInstance.seek.subscribe((t) => seeks.push(t));
    fixture.detectChanges();
    band = fixture.nativeElement.querySelector('.band');
  });

  it('rend un dégradé des couleurs valides et un curseur', () => {
    const stops = band.querySelectorAll('stop');
    expect(stops.length).toBe(3);
    expect(stops[1].getAttribute('stop-color')).toBe('#808080');
    expect(stops[1].getAttribute('offset')).toBe('37.5%');
    expect(band.querySelector<HTMLElement>('.cursor')?.style.left).toBe('25%');
  });

  it('est un slider accessible nommé « palette dominante »', () => {
    expect(band.getAttribute('role')).toBe('slider');
    expect(band.getAttribute('aria-label')?.toLowerCase()).toBe('palette dominante');
    expect(band.getAttribute('tabindex')).toBe('0');
    expect(band.getAttribute('aria-valuetext')).toBe('0:10 sur 0:40');
  });

  it('émet seek au clic et au clavier', () => {
    vi.spyOn(band, 'getBoundingClientRect').mockReturnValue(
      { left: 50, width: 200, top: 0, height: 20 } as DOMRect,
    );
    band.dispatchEvent(new MouseEvent('click', { clientX: 150, bubbles: true }));
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    band.dispatchEvent(key);
    band.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(key.defaultPrevented).toBe(true);
    expect(seeks).toEqual([20, 11, 40]);
  });

  it('affiche une bande neutre sans palette', () => {
    fixture.componentRef.setInput('palette', []);
    fixture.detectChanges();
    expect(band.querySelector('rect.empty')).not.toBeNull();
    expect(band.querySelector('linearGradient')).toBeNull();
  });
});
