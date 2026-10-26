import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { Clip, ClipSummary } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { ClipService } from '../../shared/services/clip.service';
import { ClipCompareComponent, compareClips, summarizeComparison } from './clip-compare';

function makeClip(id: string, title: string, durationSec: number, avgShotLength: number, syncScore: number | null): Clip {
  return {
    id,
    title,
    originalName: `${id}.mp4`,
    mimeType: 'video/mp4',
    size: 1024,
    durationSec,
    cutCount: Math.round(durationSec / avgShotLength) - 1,
    avgShotLength,
    syncScore,
    createdAt: '2026-10-01T10:00:00.000Z',
    analysis: { version: 1, durationSec, cuts: [5, 10], beats: [1, 2, 3], syncScore },
  };
}

function page(items: ClipSummary[]): Page<ClipSummary> {
  return {
    items,
    page: 1,
    limit: 20,
    total: items.length,
    pages: 1,
    hasPrevPage: false,
    hasNextPage: false,
    prevPage: null,
    nextPage: null,
  };
}

const chase = makeClip('c1', 'Poursuite', 30, 2, 2.1);
const talk = makeClip('c2', 'Dialogue', 60, 3.6, 1.02);
const clips: Record<string, Clip> = { c1: chase, c2: talk };

describe('clip-compare : fonctions pures', () => {
  it('désigne le plus nerveux et le plus calé sur la musique', () => {
    expect(compareClips(chase, talk)).toEqual({ nervous: 'a', nervousRatio: 1.8, synced: 'a' });
    expect(compareClips(talk, chase).nervous).toBe('b');
    expect(compareClips(chase, chase)).toEqual({ nervous: null, nervousRatio: 1, synced: null });
    expect(compareClips(makeClip('x', 'X', 30, 2, null), talk).synced).toBe('b');
  });

  it('rédige une synthèse en français', () => {
    expect(summarizeComparison(chase, talk)).toBe(
      'A (« Poursuite ») est 1,8× plus nerveux que B (« Dialogue »). ' +
        'A (« Poursuite ») est le plus calé sur la musique (× 2,10 contre × 1,02).',
    );
    const silent = makeClip('x', 'X', 30, 2, null);
    expect(summarizeComparison(silent, silent)).toBe(
      'Les deux extraits ont le même rythme de montage. Aucune des deux bandes-son n’est analysable.',
    );
  });
});

describe('ClipCompareComponent', () => {
  let service: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = {
      list: vi.fn(() => of(page([chase, talk]))),
      get: vi.fn((id: string): Observable<Clip> => of(clips[id])),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'clips/compare', component: ClipCompareComponent }]),
        { provide: ClipService, useValue: service },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    const root: HTMLElement = harness.routeNativeElement!;
    return { harness, root };
  }

  async function choose(harness: RouterTestingHarness, root: HTMLElement, side: 'a' | 'b', id: string) {
    const select = root.querySelector<HTMLSelectElement>(`select[data-side="${side}"]`)!;
    select.value = id;
    select.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  it('propose les extraits et charge chaque côté choisi, reflété dans l’URL', async () => {
    const { harness, root } = await open('/clips/compare');
    expect(service.list).toHaveBeenCalledWith(1, 20);
    expect(root.querySelectorAll('select[data-side="a"] option').length).toBe(3);
    expect(root.querySelector('label')?.textContent).toContain('Extrait A');
    expect(root.querySelectorAll('app-pulse-timeline').length).toBe(0);

    await choose(harness, root, 'a', 'c1');
    await choose(harness, root, 'b', 'c2');

    expect(TestBed.inject(Router).url).toBe('/clips/compare?a=c1&b=c2');
    expect(service.get.mock.calls).toEqual([['c1'], ['c2']]);
    expect(root.querySelectorAll('app-pulse-timeline').length).toBe(2);
    expect(root.querySelector('.summary')?.textContent).toContain('A (« Poursuite ») est 1,8× plus nerveux');
  });

  it('restaure la sélection depuis l’URL et aligne les timelines sur la plus longue durée', async () => {
    const { root } = await open('/clips/compare?a=c1&b=c2');
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(root.querySelector<HTMLSelectElement>('select[data-side="a"]')?.value).toBe('c1');
    expect(root.querySelector<HTMLSelectElement>('select[data-side="b"]')?.value).toBe('c2');

    const sliders = root.querySelectorAll('[role="slider"]');
    expect(sliders[0].getAttribute('aria-valuemax')).toBe('30');
    const lastTick = [...root.querySelectorAll('.timeline-a .tick')].at(-1);
    expect(lastTick?.textContent).toBe('1:00');
  });

  it('affiche un tableau accessible mettant en évidence les gagnants', async () => {
    const { root } = await open('/clips/compare?a=c1&b=c2');
    const table = root.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent).toContain('Poursuite');
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(3);
    expect(table.querySelectorAll('th[scope="row"]').length).toBe(5);
    const winners = [...table.querySelectorAll('td.winner')].map((cell) => cell.textContent);
    expect(winners.length).toBe(2);
    expect(winners[0]).toContain('Plus nerveux');
    expect(winners[1]).toContain('Plus calé sur la musique');
  });

  it('annule la requête précédente quand un côté change', async () => {
    const pending = new Subject<Clip>();
    service.get.mockImplementation((id: string) => (id === 'c1' ? pending : of(clips[id])));
    const { harness, root } = await open('/clips/compare?a=c1');
    expect(root.querySelector('.timeline-a [role="status"]')?.textContent).toContain('Chargement');

    await choose(harness, root, 'a', 'c2');
    expect(pending.observed).toBe(false);
    expect(root.querySelector('.timeline-a h3')?.textContent).toContain('Dialogue');
  });

  it('signale une erreur d’un seul côté', async () => {
    service.get.mockImplementation((id: string) =>
      id === 'c2' ? throwError(() => new HttpErrorResponse({ status: 404 })) : of(clips[id]),
    );
    const { root } = await open('/clips/compare?a=c1&b=c2');
    expect(root.querySelector('.timeline-a app-pulse-timeline')).not.toBeNull();
    expect(root.querySelector('.timeline-b [role="alert"]')?.textContent).toContain('Extrait introuvable');
    expect(root.querySelector('table')).toBeNull();
  });

  it('affiche un état vide avec moins de deux extraits', async () => {
    service.list.mockReturnValue(of(page([chase])));
    const { root } = await open('/clips/compare');
    expect(root.querySelector('.empty')?.textContent).toContain('au moins deux extraits');
    expect(root.querySelector('select')).toBeNull();
  });
});
