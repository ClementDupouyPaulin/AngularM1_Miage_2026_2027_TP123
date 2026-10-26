import { TestBed } from '@angular/core/testing';
import { FRAME_STEP_SEC, VideoPlayerComponent, fasterRate, formatRate, shortcutAction } from './video-player';

describe('video-player : fonctions pures', () => {
  it('associe les raccourcis J/K/L, espace et flèches', () => {
    expect(shortcutAction(' ', false)).toBe('toggle');
    expect(shortcutAction('k', false)).toBe('pause');
    expect(shortcutAction('L', false)).toBe('forward');
    expect(shortcutAction('j', false)).toBe('rewind');
    expect(shortcutAction('ArrowLeft', false)).toBe('frame-back');
    expect(shortcutAction('ArrowRight', true)).toBe('second-forward');
    expect(shortcutAction('x', false)).toBeNull();
  });

  it('accélère jusqu’à 2× et formate la vitesse', () => {
    expect(fasterRate(1)).toBe(1.25);
    expect(fasterRate(2)).toBe(2);
    expect(formatRate(0.25)).toBe('0,25×');
  });
});

describe('VideoPlayerComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(VideoPlayerComponent);
    fixture.componentRef.setInput('src', 'blob:video');
    fixture.componentRef.setInput('label', 'Poursuite');
    fixture.componentRef.setInput('cuts', [5, 10]);
    fixture.componentRef.setInput('durationSec', 20);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const video = root.querySelector('video') as HTMLVideoElement;
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    return { fixture, root, video, component: fixture.componentInstance };
  }

  it('affiche des commandes accessibles et sans contrôles natifs', () => {
    const { root, video } = setup();
    expect(video.hasAttribute('controls')).toBe(false);
    const labels = Array.from(root.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining(['Lecture', 'Image précédente', 'Image suivante', 'Coupe suivante', 'Plein écran']),
    );
    expect(root.querySelector('select')?.options).toHaveLength(7);
  });

  it('saute, borne et émet le temps', () => {
    const { component, video } = setup();
    const emitted: number[] = [];
    component.timeChange.subscribe((time) => emitted.push(time));
    component.seekTo(25);
    expect(video.currentTime).toBe(20);
    component.goToPreviousCut();
    expect(emitted).toEqual([20, 10]);
  });

  it('avance image par image avec la flèche droite et met en pause', () => {
    const { root, video, component } = setup();
    component.seekTo(2);
    root.querySelector('.player')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(video.pause).toHaveBeenCalled();
    expect(component.currentTime()).toBeCloseTo(2 + FRAME_STEP_SEC);
  });

  it('change la vitesse de lecture', () => {
    const { root, video, fixture } = setup();
    const select = root.querySelector('select') as HTMLSelectElement;
    select.value = '0.5';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(video.playbackRate).toBe(0.5);
    expect(fixture.componentInstance.rate()).toBe(0.5);
  });
});
