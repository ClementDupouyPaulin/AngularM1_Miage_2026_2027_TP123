import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ClipSummary } from '../../shared/models/clip.model';
import { Page } from '../../shared/models/page.model';
import { ClipService, DiscoverOptions } from '../../shared/services/clip.service';
import { ClipCardComponent } from '../clip-card/clip-card';
import { DiscoverPageComponent, SEARCH_DEBOUNCE_MS, rankLabel } from './discover-page';

@Component({
  selector: 'app-clip-card',
  template: `<button type="button" class="fake-card" (click)="open.emit(clip())">{{ clip().title }}</button>`,
})
class FakeClipCardComponent {
  readonly clip = input.required<ClipSummary>();
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly showOwner = input(false);
  readonly deletable = input(false);
  readonly open = output<ClipSummary>();
  readonly toggleSelect = output<ClipSummary>();
  readonly remove = output<ClipSummary>();
}

function makeClip(id: string, overrides: Partial<ClipSummary> = {}): ClipSummary {
  return {
    id,
    title: `Extrait ${id}`,
    originalName: `${id}.mp4`,
    mimeType: 'video/mp4',
    size: 1024,
    durationSec: 30,
    cutCount: 12,
    avgShotLength: 2.5,
    syncScore: 1.5,
    createdAt: '2026-10-01T00:00:00.000Z',
    tags: [],
    visibility: 'public',
    owner: { id: 'u2', name: 'Ada Lovelace' },
    isOwner: false,
    hasFilmstrip: false,
    sparkline: [],
    ...overrides,
  };
}

function makePage(items: ClipSummary[], total = items.length): Page<ClipSummary> {
  return {
    items,
    page: 1,
    limit: 12,
    total,
    pages: Math.max(1, Math.ceil(total / 12)),
    hasPrevPage: false,
    hasNextPage: total > 12,
    prevPage: null,
    nextPage: total > 12 ? 2 : null,
  };
}

describe('DiscoverPageComponent', () => {
  let fixture: ComponentFixture<DiscoverPageComponent>;
  let component: DiscoverPageComponent;
  let discover: ReturnType<typeof vi.fn<(options: DiscoverOptions) => Observable<Page<ClipSummary>>>>;
  let navigate: ReturnType<typeof vi.fn>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function lastOptions(): DiscoverOptions {
    return discover.mock.calls.at(-1)![0];
  }

  function setup(response: (options: DiscoverOptions) => Observable<Page<ClipSummary>>) {
    discover = vi.fn(response);
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClipService, useValue: { discover } },
        { provide: Router, useValue: { navigate } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    TestBed.overrideComponent(DiscoverPageComponent, {
      remove: { imports: [ClipCardComponent] },
      add: { imports: [FakeClipCardComponent] },
    });
    fixture = TestBed.createComponent(DiscoverPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => vi.useRealTimers());

  it('charge les extraits publics récents et affiche les cartes', () => {
    setup(() => of(makePage([makeClip('a'), makeClip('b')])));

    expect(lastOptions()).toEqual({ scope: 'public', sort: 'recent', page: 1, limit: 12 });
    expect(element().querySelectorAll('.fake-card').length).toBe(2);
    expect(element().querySelector('[role="status"]')?.textContent).toContain('2 extraits trouvés');
  });

  it('montre des squelettes pendant le chargement puis l’état vide', () => {
    const pending = new Subject<Page<ClipSummary>>();
    setup(() => pending);
    expect(element().querySelectorAll('.skeleton-card').length).toBeGreaterThan(0);

    pending.next(makePage([]));
    fixture.detectChanges();
    expect(element().querySelector('.empty-state')?.textContent).toContain('Aucun extrait public');
  });

  it('affiche une erreur et permet de réessayer', () => {
    let fail = true;
    setup(() =>
      fail ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(makePage([makeClip('a')])),
    );
    expect(element().querySelector('.load-error')?.textContent).toContain('injoignable');

    fail = false;
    (element().querySelector('.load-error button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element().querySelectorAll('.fake-card').length).toBe(1);
  });

  it('change de portée via les onglets et gère le clavier', () => {
    setup(() => of(makePage([])));
    const tabs = element().querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    tabs[1].click();
    fixture.detectChanges();
    expect(lastOptions().scope).toBe('friends');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('tabindex')).toBe('-1');
    expect(element().querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      'discover-tab-friends',
    );

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(lastOptions().scope).toBe('shared');
    expect(document.activeElement === tabs[2] || component.tab() === 'shared').toBe(true);
  });

  it('applique la recherche après l’anti-rebond, en revenant à la page 1', () => {
    vi.useFakeTimers();
    setup(() => of(makePage([makeClip('a')])));
    const calls = discover.mock.calls.length;

    component.search.setValue('  plage ');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(discover.mock.calls.length).toBe(calls);

    vi.advanceTimersByTime(1);
    expect(lastOptions()).toMatchObject({ q: 'plage', page: 1 });
  });

  it('trie par nervosité via le sélecteur', () => {
    setup(() => of(makePage([makeClip('a')])));
    const select = element().querySelector('#discover-sort') as HTMLSelectElement;
    select.value = 'nervous';
    select.dispatchEvent(new Event('change'));
    expect(lastOptions().sort).toBe('nervous');
  });

  it('dérive les puces d’étiquettes des résultats et filtre par étiquette', () => {
    setup(() => of(makePage([makeClip('a', { tags: ['plage', 'nuit'] }), makeClip('b', { tags: ['nuit'] })])));
    const chips = element().querySelectorAll<HTMLButtonElement>('.tag-chip');
    expect([...chips].map((chip) => chip.textContent?.trim())).toEqual(['#nuit', '#plage']);

    chips[1].click();
    fixture.detectChanges();
    expect(lastOptions().tag).toBe('plage');
    const active = element().querySelector('.tag-chip[aria-pressed="true"]');
    expect(active?.textContent).toContain('plage');
  });

  it('ouvre un extrait depuis sa carte', () => {
    setup(() => of(makePage([makeClip('abc')])));
    (element().querySelector('.fake-card') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/clips', 'abc']);
  });

  it('pagine côté serveur', () => {
    setup(() => of(makePage([makeClip('a')], 30)));
    component.onPage({ pageIndex: 1, pageSize: 24, length: 30 });
    expect(lastOptions()).toMatchObject({ page: 2, limit: 24 });
  });

  describe('classements', () => {
    function rankingSetup() {
      setup((options) => {
        if (options.sort === 'nervous') {
          return of(makePage([makeClip('n1', { avgShotLength: 0.8 }), makeClip('n2'), makeClip('n3'), makeClip('n4')]));
        }
        if (options.sort === 'synced') {
          return of(makePage([makeClip('s1', { syncScore: 3.456 }), makeClip('s2', { syncScore: null })]));
        }
        return of(makePage([]));
      });
      (element().querySelector('#discover-tab-rankings') as HTMLButtonElement).click();
      fixture.detectChanges();
    }

    it('charge les deux top 10 publics une seule fois', () => {
      rankingSetup();
      const sorts = discover.mock.calls.map(([options]) => options).filter((o) => o.sort !== 'recent');
      expect(sorts).toEqual([
        { scope: 'public', sort: 'nervous', page: 1, limit: 10 },
        { scope: 'public', sort: 'synced', page: 1, limit: 10 },
      ]);

      component.selectTab('public');
      component.selectTab('rankings');
      expect(discover.mock.calls.filter(([o]) => o.sort === 'nervous').length).toBe(1);
    });

    it('affiche podium, rangs en texte et métriques', () => {
      rankingSetup();
      const nervous = element().querySelector('[data-board="nervous"]')!;
      const rows = nervous.querySelectorAll('tbody tr');
      expect(rows.length).toBe(4);
      expect(nervous.querySelectorAll('.podium').length).toBe(3);
      expect(nervous.querySelectorAll('.medal[aria-hidden="true"]').length).toBe(3);
      expect(rows[0].querySelector('.rank-label')?.textContent).toBe('1er');
      expect(rows[0].querySelector('.metric')?.textContent).toContain('0,8 s');
      expect(rows[0].querySelector('.owner')?.textContent).toContain('Ada Lovelace');

      const synced = element().querySelector('[data-board="synced"]')!;
      expect(synced.querySelectorAll('tbody tr').length).toBe(1);
      expect(synced.querySelector('.metric')?.textContent).toContain('3,46');
    });

    it('ouvre l’extrait au clic sur une ligne', () => {
      rankingSetup();
      (element().querySelector('[data-board="synced"] .row-open') as HTMLButtonElement).click();
      expect(navigate).toHaveBeenCalledWith(['/clips', 's1']);
    });

    it('formate le rang', () => {
      expect(rankLabel(0)).toBe('1er');
      expect(rankLabel(1)).toBe('2e');
      expect(rankLabel(9)).toBe('10e');
    });
  });
});
