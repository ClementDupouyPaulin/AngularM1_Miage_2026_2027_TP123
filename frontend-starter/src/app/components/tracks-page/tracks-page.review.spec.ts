import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { Page } from '../../shared/models/page.model';
import { Track } from '../../shared/models/track.model';
import { SEARCH_DEBOUNCE_MS, TracksPageComponent } from './tracks-page';

/**
 * Relecture indépendante : cas à risque que `tracks-page.spec.ts` ne couvre pas
 * (liste hors bornes après une suppression faite ailleurs, course filtre /
 * pagination, remplacement de l'aperçu de pochette, rendu de données hostiles
 * issues des tags ID3).
 */
describe('TracksPageComponent (relecture indépendante)', () => {
  function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
    return {
      id,
      title: `Piste ${id}`,
      originalName: `${id}.mp3`,
      mimeType: 'audio/mpeg',
      size: 2048,
      createdAt: '2026-01-01T00:00:00.000Z',
      artist: null,
      album: null,
      hasCover: false,
      coverSource: null,
      ...overrides,
    };
  }

  function makePage(items: Track[], overrides: Partial<Page<Track>> = {}): Page<Track> {
    const base = { items, page: 1, limit: 5, total: items.length, pages: 1, ...overrides };
    return {
      hasPrevPage: base.page > 1,
      hasNextPage: base.page < base.pages,
      prevPage: base.page > 1 ? base.page - 1 : null,
      nextPage: base.page < base.pages ? base.page + 1 : null,
      ...base,
    };
  }

  let fixture: ComponentFixture<TracksPageComponent>;
  let component: TracksPageComponent;
  let httpMock: HttpTestingController;

  function expectList(page = 1, limit = 5, q?: string) {
    const query = q === undefined ? '' : `&q=${encodeURIComponent(q)}`;
    return httpMock.expectOne(
      (request) =>
        request.method === 'GET' &&
        request.urlWithParams === `/api/tracks?page=${page}&limit=${limit}${query}`,
    );
  }

  function setup(initial: Page<Track>) {
    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        // Confirmation toujours acceptée : seul le comportement de la liste nous intéresse.
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(true) })) } },
      ],
    });
    fixture = TestBed.createComponent(TracksPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    expectList(initial.page, initial.limit).flush(initial);
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('piste supprimée dans un autre onglet', () => {
    it('ne prétend pas que la bibliothèque est vide quand la page demandée est hors bornes', () => {
      // 6 pistes : la page 2 ne contient que « t6 ».
      setup(makePage([makeTrack('t1')], { pages: 2, total: 6 }));
      component.go(2);
      expectList(2).flush(makePage([makeTrack('t6')], { page: 2, pages: 2, total: 6 }));

      // Dans un autre onglet, t6 est supprimée : il reste 5 pistes, donc 1 seule page.
      component.remove(makeTrack('t6'));
      httpMock
        .expectOne('/api/tracks/t6')
        .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });
      // Le serveur renvoie `items: []` pour une page hors bornes (API_CONTRACT.md).
      expectList(component.page()).flush(
        makePage([], { page: component.page(), pages: 1, total: 5 }),
      );
      // Le composant bascule alors sur la dernière page valide et recharge UNE fois.
      expectList(1).flush(
        makePage(
          ['t1', 't2', 't3', 't4', 't5'].map((id) => makeTrack(id)),
          { page: 1, pages: 1, total: 5 },
        ),
      );
      fixture.detectChanges();

      expect(component.page()).toBe(1);
      expect(component.total()).toBe(5);
      const library = (fixture.nativeElement.querySelector('.library')?.textContent ?? '')
        .replace(/\s+/g, ' ');
      // Cinq morceaux existent : afficher « vide » est faux et laisse l'utilisateur sans piste visible.
      expect(library).not.toContain('Votre bibliothèque est vide');
      expect(component.tracks().map((track) => track.id)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    });
  });

  describe('courses entre requêtes', () => {
    it('une page demandée avant un filtre ne l’écrase pas quand elle répond en retard', () => {
      vi.useFakeTimers();
      setup(makePage([makeTrack('t1')], { pages: 3, total: 11 }));

      component.go(2);
      const pageTwo = expectList(2);

      component.search.setValue('blues');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      const filtered = expectList(1, 5, 'blues');

      filtered.flush(makePage([makeTrack('b1')], { total: 1 }));
      // Réponse périmée : page 2 SANS filtre, arrivée après la réponse du filtre.
      pageTwo.flush(makePage([makeTrack('perime')], { page: 2, pages: 3, total: 11 }));

      expect(component.tracks().map((track) => track.id)).toEqual(['b1']);
      expect(component.page()).toBe(1);
      expect(component.total()).toBe(1);
      expect(component.loading()).toBe(false);
    });

    it('une erreur d’une réponse périmée n’affiche pas d’erreur par-dessus la liste à jour', () => {
      setup(makePage([makeTrack('t1')], { pages: 2, total: 6 }));

      component.go(2);
      // « Actualiser » pendant le chargement : deux requêtes identiques en vol.
      component.load();
      const [stale, fresh] = httpMock.match(
        (request) => request.urlWithParams === '/api/tracks?page=2&limit=5',
      );
      expect(stale).toBeDefined();
      expect(fresh).toBeDefined();

      fresh.flush(makePage([makeTrack('t6')], { page: 2, pages: 2, total: 6 }));
      stale.flush({ message: 'Erreur tardive' }, { status: 500, statusText: 'Server Error' });

      expect(component.error()).toBe('');
      expect(component.tracks().map((track) => track.id)).toEqual(['t6']);
    });
  });

  describe('aperçu de la pochette choisie à l’upload (ObjectURL)', () => {
    function image(name: string, type = 'image/png'): File {
      return new File([new Uint8Array(10)], name, { type });
    }

    function mockObjectUrls() {
      let counter = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:apercu-${++counter}`);
      return vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }

    it('remplacer l’image libère l’aperçu précédent, la destruction libère le dernier', () => {
      setup(makePage([makeTrack('t1')]));
      const revoke = mockObjectUrls();

      component.selectCover(image('a.png'));
      component.selectCover(image('b.png'));

      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:apercu-1');
      expect(component.coverPreviewUrl()).toBe('blob:apercu-2');

      fixture.destroy();
      expect(revoke).toHaveBeenCalledTimes(2);
      expect(revoke).toHaveBeenLastCalledWith('blob:apercu-2');
    });

    it('choisir une image invalide après une valide libère l’aperçu et vide la sélection', () => {
      setup(makePage([makeTrack('t1')]));
      const revoke = mockObjectUrls();

      component.selectCover(image('a.png'));
      component.selectCover(image('malveillante.svg', 'image/svg+xml'));

      expect(revoke).toHaveBeenCalledWith('blob:apercu-1');
      expect(component.coverFile()).toBeUndefined();
      expect(component.coverPreviewUrl()).toBe('');
      expect(component.coverError()).not.toBe('');
    });
  });

  describe('rendu de données issues des tags ID3 (non fiables)', () => {
    it('affiche titre, artiste et album comme du texte, sans créer d’élément HTML', () => {
      const hostile = '<img src=x onerror="window.__xss = true"><script>window.__xss = true</script>';
      setup(
        makePage([
          makeTrack('t1', {
            title: hostile,
            artist: hostile,
            album: hostile,
            originalName: hostile,
          }),
        ]),
      );

      const list: HTMLElement = fixture.nativeElement.querySelector('ul.tracks');
      expect(list.querySelector('img')).toBeNull();
      expect(list.querySelector('script')).toBeNull();
      expect(list.querySelector('[onerror]')).toBeNull();
      expect(list.textContent).toContain('<img src=x onerror=');
      expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
    });
  });
});
