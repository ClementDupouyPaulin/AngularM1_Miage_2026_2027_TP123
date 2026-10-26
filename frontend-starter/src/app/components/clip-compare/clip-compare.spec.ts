import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { Clip, ClipSummary } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { DiscoverOptions, ClipService } from '../../shared/services/clip.service';
import {
  ClipCompareComponent,
  buildOptionGroups,
  compareClips,
  comparisonRows,
  summarizeComparison,
} from './clip-compare';

interface ClipOptions {
  isOwner?: boolean;
  visibility?: Clip['visibility'];
  owner?: string;
  beats?: number[];
}

function makeClip(
  id: string,
  title: string,
  durationSec: number,
  avgShotLength: number,
  syncScore: number | null,
  options: ClipOptions = {},
): Clip {
  const cutCount = Math.round(durationSec / avgShotLength) - 1;
  const cuts = Array.from({ length: cutCount }, (_, i) => (i + 1) * avgShotLength);
  return {
    id,
    title,
    originalName: `${id}.mp4`,
    mimeType: 'video/mp4',
    size: 1024,
    durationSec,
    cutCount,
    avgShotLength,
    syncScore,
    createdAt: '2026-10-01T10:00:00.000Z',
    tags: [],
    visibility: options.visibility ?? 'private',
    owner: { id: options.owner ?? 'u1', name: options.owner === 'u2' ? 'Léa' : 'Moi' },
    isOwner: options.isOwner ?? true,
    hasFilmstrip: false,
    sparkline: [],
    analysis: {
      version: 2,
      durationSec,
      fps: 10,
      cuts,
      beats: options.beats ?? [0.5, 1, 1.5, 2, 2.5, 3],
      syncScore,
      diffs: [],
      palette: ['#112233', '#445566'],
      transitions: [...cuts.map((time) => ({ time, kind: 'cut' as const })), { time: 1, kind: 'fade' as const }],
      thumbnailTimes: [0],
      sensitivity: 3,
    },
    annotations: [],
    sharedWith: [],
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
const plaza = makeClip('p1', 'Place publique', 20, 4, null, { isOwner: false, visibility: 'public', owner: 'u2' });
const secret = makeClip('f1', 'Partage de Léa', 40, 5, 1.3, { isOwner: false, visibility: 'shared', owner: 'u2' });
const clips: Record<string, Clip> = { c1: chase, c2: talk, p1: plaza, f1: secret };

describe('clip-compare : fonctions pures', () => {
  it('désigne le plus nerveux et le plus calé sur la musique', () => {
    expect(compareClips(chase, talk)).toEqual({ nervous: 'a', nervousRatio: 1.8, synced: 'a' });
    expect(compareClips(talk, chase).nervous).toBe('b');
    expect(compareClips(chase, chase)).toEqual({ nervous: null, nervousRatio: 1, synced: null });
    expect(compareClips(plaza, talk).synced).toBe('b');
  });

  it('rédige une synthèse en français', () => {
    expect(summarizeComparison(chase, talk)).toBe(
      'A (« Poursuite ») est 1,8× plus nerveux que B (« Dialogue »). ' +
        'A (« Poursuite ») est le plus calé sur la musique (× 2,10 contre × 1,02).',
    );
    expect(summarizeComparison(plaza, plaza)).toBe(
      'Les deux extraits ont le même rythme de montage. Aucune des deux bandes-son n’est analysable.',
    );
  });

  it('produit le tableau étendu', () => {
    const rows = comparisonRows({ a: chase, b: talk });
    expect(rows.map((row) => row.label)).toEqual([
      'Durée',
      'Coupes',
      'Fondus',
      'Plan moyen (ASL)',
      'Plan médian',
      'Coupes par minute',
      'Profil de rythme',
      'BPM musique',
      'Synchro coupes / musique',
    ]);
    expect(rows[2].values).toEqual(['1', '1']);
    expect(rows[5].values).toEqual(['28,0', '16,0']);
    expect(rows[6].values).toEqual(['Nerveux', 'Soutenu']);
    expect(rows[7].values).toEqual(['120 BPM', '120 BPM']);
  });

  it('groupe les options sans doublon et range les extraits de l’URL', () => {
    const groups = buildOptionGroups({ mine: [chase], public: [plaza], friends: [plaza, secret] }, [talk, secret]);
    expect(groups.map((group) => [group.label, group.items.map((clip) => clip.id)])).toEqual([
      ['Mes extraits', ['c1', 'c2']],
      ['Publics', ['p1']],
      ['Amis', ['f1']],
    ]);
  });
});

describe('ClipCompareComponent', () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    discover: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    video: ReturnType<typeof vi.fn>;
    filmstrip: ReturnType<typeof vi.fn>;
  };
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;
  let playSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let pauseSpy: ReturnType<typeof vi.fn<() => void>>;
  const { createObjectURL, revokeObjectURL } = URL;
  let urlCount = 0;

  beforeEach(() => {
    service = {
      list: vi.fn(() => of(page([chase, talk]))),
      discover: vi.fn((options: DiscoverOptions) => of(page(options.scope === 'public' ? [plaza] : []))),
      get: vi.fn((id: string): Observable<Clip> => of(clips[id])),
      video: vi.fn(() => of(new Blob(['v']))),
      filmstrip: vi.fn(() => of(new Blob(['f']))),
    };
    urlCount = 0;
    URL.createObjectURL = vi.fn(() => `blob:url-${++urlCount}`);
    revokeSpy = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revokeSpy;
    playSpy = vi.fn(() => Promise.resolve());
    pauseSpy = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playSpy);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseSpy);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'clips/compare', component: ClipCompareComponent }]),
        { provide: ClipService, useValue: service },
      ],
    });
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  function video(root: HTMLElement, side: 'a' | 'b'): HTMLVideoElement {
    return root.querySelector<HTMLVideoElement>(`video[data-side="${side}"]`)!;
  }

  describe('sélection et URL', () => {
    it('regroupe les listes par origine et reflète la sélection dans l’URL', async () => {
      const { harness, root } = await open('/clips/compare');
      expect(service.list).toHaveBeenCalledWith(1, 20);
      expect(service.discover).toHaveBeenCalledWith({ scope: 'public', limit: 20 });
      expect(service.discover).toHaveBeenCalledWith({ scope: 'friends', limit: 20 });
      const labels = [...root.querySelectorAll('select[data-side="a"] optgroup')].map((group) => group.getAttribute('label'));
      expect(labels).toEqual(['Mes extraits', 'Publics']);
      expect(root.querySelectorAll('select[data-side="a"] option').length).toBe(4);

      await choose(harness, root, 'a', 'c1');
      await choose(harness, root, 'b', 'c2');

      expect(TestBed.inject(Router).url).toBe('/clips/compare?a=c1&b=c2');
      expect(service.get.mock.calls).toEqual([['c1'], ['c2']]);
      expect(root.querySelectorAll('app-pulse-timeline').length).toBe(2);
      expect(root.querySelector('.summary')?.textContent).toContain('A (« Poursuite ») est 1,8× plus nerveux');
    });

    it('rend le même extrait non sélectionnable de l’autre côté', async () => {
      const { root } = await open('/clips/compare?a=c1');
      const optionB = root.querySelector<HTMLOptionElement>('select[data-side="b"] option[value="c1"]')!;
      expect(optionB.disabled).toBe(true);
      expect(root.querySelector<HTMLOptionElement>('select[data-side="a"] option[value="c1"]')!.disabled).toBe(false);
    });

    it('charge un extrait de l’URL absent des listes et le range dans son groupe', async () => {
      const { root } = await open('/clips/compare?a=c1&b=f1');
      const friends = root.querySelector('select[data-side="b"] optgroup[label="Amis"]');
      expect(friends?.textContent).toContain('Partage de Léa');
      expect(root.querySelector<HTMLSelectElement>('select[data-side="b"]')?.value).toBe('f1');
    });

    it('aligne les timelines et les palettes sur la plus longue durée', async () => {
      const { root } = await open('/clips/compare?a=c1&b=c2');
      const lastTick = [...root.querySelectorAll('.timeline-a .tick')].at(-1);
      expect(lastTick?.textContent).toBe('01:00');
      expect(root.querySelector<HTMLElement>('.palette-a .palette-fill')?.style.width).toBe('50%');
      expect(root.querySelector<HTMLElement>('.palette-b .palette-fill')?.style.width).toBe('100%');
      expect(root.querySelector('app-shot-histogram')).not.toBeNull();
      expect(root.querySelector('app-acceleration-chart')).not.toBeNull();
    });

    it('annule la requête précédente quand un côté change', async () => {
      const pending = new Subject<Clip>();
      service.get.mockImplementation((id: string) => (id === 'c1' ? pending : of(clips[id])));
      const { harness, root } = await open('/clips/compare?a=c1');
      expect(root.querySelector('.player-a [role="status"]')?.textContent).toContain('Chargement');

      await choose(harness, root, 'a', 'c2');
      expect(pending.observed).toBe(false);
      expect(root.querySelector('.player-a h3')?.textContent).toContain('Dialogue');
    });
  });

  describe('synthèse et tableau', () => {
    it('affiche un tableau accessible, les verdicts et les liens vers les salles de montage', async () => {
      const { root } = await open('/clips/compare?a=c1&b=c2');
      const table = root.querySelector('table')!;
      expect(table.querySelector('caption')?.textContent).toContain('Poursuite');
      expect(table.querySelectorAll('th[scope="col"]').length).toBe(3);
      expect(table.querySelectorAll('th[scope="row"]').length).toBe(9);
      const winners = [...table.querySelectorAll('td.winner')].map((cell) => cell.textContent);
      expect(winners.length).toBe(2);
      expect(winners[0]).toContain('Plus nerveux');
      expect(winners[1]).toContain('Plus calé sur la musique');
      const verdicts = [...root.querySelectorAll('.verdict')].map((item) => item.textContent?.trim());
      expect(verdicts[0]).toContain('Plus nerveux : A (« Poursuite »)');
      expect(verdicts[1]).toContain('Plus calé sur la musique : A');
      const links = [...root.querySelectorAll('.profile a')].map((link) => link.getAttribute('href'));
      expect(links).toEqual(['/clips/c1', '/clips/c2']);
      expect(root.querySelector('.profile-a .chip')?.textContent).toContain('Nerveux');
    });
  });

  describe('erreurs par côté', () => {
    it('signale l’extrait introuvable d’un seul côté', async () => {
      service.get.mockImplementation((id: string) =>
        id === 'c2' ? throwError(() => new HttpErrorResponse({ status: 404 })) : of(clips[id]),
      );
      const { root } = await open('/clips/compare?a=c1&b=c2');
      expect(root.querySelector('.timeline-a app-pulse-timeline')).not.toBeNull();
      expect(root.querySelector('.player-b [role="alert"]')?.textContent).toContain('Extrait introuvable');
      expect(root.querySelector('table')).toBeNull();
      expect(root.querySelector<HTMLButtonElement>('.play')?.disabled).toBe(true);
    });

    it('signale une vidéo indisponible sans bloquer les statistiques', async () => {
      service.video.mockImplementation((id: string) =>
        id === 'c1' ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(new Blob(['v'])),
      );
      const { root } = await open('/clips/compare?a=c1&b=c2');
      expect(root.querySelector('.player-a [role="alert"]')?.textContent).toContain('Serveur injoignable');
      expect(video(root, 'b')).not.toBeNull();
      expect(root.querySelector('table')).not.toBeNull();
      expect(root.querySelector<HTMLButtonElement>('.play')?.disabled).toBe(true);
    });

    it('signale une liste indisponible sans bloquer les autres', async () => {
      service.discover.mockImplementation((options: DiscoverOptions) =>
        options.scope === 'friends' ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(page([plaza])),
      );
      const { root } = await open('/clips/compare');
      expect(root.querySelector('.alert-info')?.textContent).toContain('Liste indisponible : Amis.');
      expect(root.querySelector('select')).not.toBeNull();
    });
  });

  describe('état vide', () => {
    it('affiche un état vide avec moins de deux extraits accessibles', async () => {
      service.list.mockReturnValue(of(page([chase])));
      service.discover.mockReturnValue(of(page([])));
      const { root } = await open('/clips/compare');
      expect(root.querySelector('.empty')?.textContent).toContain('au moins deux extraits');
      expect(root.querySelector('select')).toBeNull();
    });

    it('compte aussi les extraits publics et partagés', async () => {
      service.list.mockReturnValue(of(page([chase])));
      const { root } = await open('/clips/compare');
      expect(root.querySelector('.empty')).toBeNull();
      expect(root.querySelector('select')).not.toBeNull();
    });
  });

  describe('lecture synchronisée', () => {
    it('lit et met en pause les deux vidéos ensemble', async () => {
      const { harness, root } = await open('/clips/compare?a=c1&b=c2');
      expect(video(root, 'a').src).toBe('blob:url-1');
      const play = root.querySelector<HTMLButtonElement>('.play')!;
      expect(play.disabled).toBe(false);

      play.click();
      await harness.fixture.whenStable();
      harness.detectChanges();
      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(play.getAttribute('aria-label')).toBe('Mettre en pause les deux vidéos');

      play.click();
      harness.detectChanges();
      expect(pauseSpy).toHaveBeenCalledTimes(2);
      expect(play.textContent).toContain('Lire');
    });

    it('ralentit le plus court en mode relatif et positionne chaque lecteur', async () => {
      const { harness, root } = await open('/clips/compare?a=c1&b=c2');
      const relative = root.querySelector<HTMLInputElement>('input[type="radio"][value="relative"]')!;
      relative.click();
      harness.detectChanges();
      expect(video(root, 'a').playbackRate).toBe(0.5);
      expect(video(root, 'b').playbackRate).toBe(1);

      const scrub = root.querySelector<HTMLInputElement>('input[type="range"]')!;
      scrub.value = '30';
      scrub.dispatchEvent(new Event('input'));
      harness.detectChanges();
      expect(video(root, 'a').currentTime).toBe(15);
      expect(video(root, 'b').currentTime).toBe(30);
      expect(scrub.getAttribute('aria-valuetext')).toBe('00:30 sur 01:00');
    });

    it('coupe le son de chaque côté indépendamment', async () => {
      const { harness, root } = await open('/clips/compare?a=c1&b=c2');
      const muteA = root.querySelector<HTMLButtonElement>('.mute[data-side="a"]')!;
      expect(muteA.getAttribute('aria-pressed')).toBe('false');
      expect(video(root, 'b').muted).toBe(true);
      muteA.click();
      harness.detectChanges();
      expect(muteA.getAttribute('aria-pressed')).toBe('true');
      expect(video(root, 'a').muted).toBe(true);
    });

    it('n’arrête le transport qu’à la fin du plus long extrait', async () => {
      const { harness, root } = await open('/clips/compare?a=c1&b=c2');
      const play = root.querySelector<HTMLButtonElement>('.play')!;
      play.click();
      harness.detectChanges();
      video(root, 'a').dispatchEvent(new Event('ended'));
      harness.detectChanges();
      expect(play.textContent).toContain('Pause');
      video(root, 'b').dispatchEvent(new Event('ended'));
      harness.detectChanges();
      expect(play.textContent).toContain('Lire');
    });

    it('révoque les ObjectURL en quittant la page', async () => {
      const { harness } = await open('/clips/compare?a=c1&b=c2');
      harness.fixture.destroy();
      expect(revokeSpy).toHaveBeenCalledWith('blob:url-1');
      expect(revokeSpy).toHaveBeenCalledWith('blob:url-2');
    });
  });
});
