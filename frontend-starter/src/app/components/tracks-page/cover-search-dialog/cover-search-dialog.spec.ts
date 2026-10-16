import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { CoverCandidate } from '../../../shared/models/cover-candidate.model';
import { CoverSearchResult } from '../../../shared/models/cover-search-result.model';
import {
  COVER_SEARCH_PANEL_CLASS,
  CoverSearchDialogComponent,
  CoverSearchDialogData,
} from './cover-search-dialog';

/**
 * Dialogue « Chercher sur le Web », ouvert par le vrai `MatDialog` (animations
 * coupées) : appel unique à l'ouverture, erreurs (dont 502), absence de
 * résultat, attribution, sélection puis confirmation.
 */
describe('CoverSearchDialogComponent', () => {
  const SEARCH_URL = '/api/tracks/t1/cover/search';
  const ATTRIBUTION = 'Pochettes fournies par l’API iTunes Search d’Apple.';

  function candidate(id: string): CoverCandidate {
    return {
      id,
      title: `Titre ${id}`,
      artist: `Artiste ${id}`,
      album: `Album ${id}`,
      imageUrl: `https://is1-ssl.mzstatic.com/image/${id}.jpg`,
    };
  }

  function searchResult(results: CoverCandidate[]): CoverSearchResult {
    return { query: 'Kevin MacLeod Blues', source: 'itunes', attribution: ATTRIBUTION, results };
  }

  let httpMock: HttpTestingController;
  let dialogRef: MatDialogRef<CoverSearchDialogComponent, CoverCandidate>;

  function open() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    // Aucune recherche tant que le dialogue n'est pas ouvert.
    httpMock.expectNone(SEARCH_URL);

    dialogRef = TestBed.inject(MatDialog).open<
      CoverSearchDialogComponent,
      CoverSearchDialogData,
      CoverCandidate
    >(CoverSearchDialogComponent, {
      data: { trackId: 't1', title: 'Blues' },
      panelClass: COVER_SEARCH_PANEL_CLASS,
    });
    TestBed.tick();
  }

  function container(): HTMLElement {
    return document.querySelector('mat-dialog-container') as HTMLElement;
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(container().querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(found).toBeTruthy();
    return found as HTMLButtonElement;
  }

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    httpMock.verify();
  });

  it('appelle searchCover une seule fois, à l’ouverture', () => {
    open();

    const request = httpMock.expectOne(SEARCH_URL);
    expect(request.request.method).toBe('GET');
    expect(container().textContent).toContain('Recherche de pochettes en cours');
    request.flush(searchResult([candidate('a')]));
    TestBed.tick();

    httpMock.expectNone(SEARCH_URL);
  });

  it('traduit un 502 en message compréhensible et permet de réessayer', () => {
    open();
    httpMock
      .expectOne(SEARCH_URL)
      .flush({ message: 'Service iTunes indisponible' }, { status: 502, statusText: 'Bad Gateway' });
    TestBed.tick();

    const alert = container().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('momentanément indisponible');

    button('Réessayer').click();
    TestBed.tick();

    httpMock.expectOne(SEARCH_URL).flush(searchResult([candidate('a')]));
    TestBed.tick();
    expect(container().querySelector('[role="alert"]')).toBeNull();
    expect(container().querySelectorAll('.candidate')).toHaveLength(1);
  });

  it('signale l’absence de résultat et affiche quand même l’attribution', () => {
    open();
    httpMock.expectOne(SEARCH_URL).flush(searchResult([]));
    TestBed.tick();

    expect(container().querySelector('.cover-search-empty')?.textContent).toContain(
      'Aucune pochette trouvée pour « Kevin MacLeod Blues »',
    );
    expect(container().querySelector('.attribution')?.textContent).toContain(ATTRIBUTION);
    expect(button('Utiliser cette pochette').disabled).toBe(true);
  });

  it('liste les candidats avec miniature, titre, artiste, album et attribution', () => {
    open();
    httpMock.expectOne(SEARCH_URL).flush(searchResult([candidate('a'), candidate('b')]));
    TestBed.tick();

    const items = container().querySelectorAll('.candidate');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('img')?.getAttribute('src')).toBe(
      'https://is1-ssl.mzstatic.com/image/a.jpg',
    );
    expect(items[0].textContent).toContain('Titre a');
    expect(items[0].textContent).toContain('Artiste a');
    expect(items[0].textContent).toContain('Album a');
    expect(container().querySelector('.attribution')?.textContent).toContain(ATTRIBUTION);
    expect(container().querySelector('[role="status"]')?.textContent).toContain('2 pochettes trouvées');
  });

  it('ferme avec le candidat seulement après sélection puis confirmation', async () => {
    open();
    let closedWith: CoverCandidate | undefined | 'pending' = 'pending';
    dialogRef.afterClosed().subscribe((result) => (closedWith = result));
    httpMock.expectOne(SEARCH_URL).flush(searchResult([candidate('a'), candidate('b')]));
    TestBed.tick();

    const use = button('Utiliser cette pochette');
    expect(use.disabled).toBe(true);

    const second = container().querySelectorAll<HTMLButtonElement>('.candidate')[1];
    second.click();
    TestBed.tick();
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(closedWith).toBe('pending');

    use.click();
    TestBed.tick();
    // La fermeture (et donc afterClosed) est asynchrone dans MatDialog.
    await vi.waitFor(() => expect(closedWith).toEqual(candidate('b')));
  });

  it('Échap ferme le dialogue sans candidat', async () => {
    open();
    let closedWith: CoverCandidate | undefined | 'pending' = 'pending';
    dialogRef.afterClosed().subscribe((result) => (closedWith = result));
    httpMock.expectOne(SEARCH_URL).flush(searchResult([candidate('a')]));
    TestBed.tick();

    container().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    TestBed.tick();

    await vi.waitFor(() => expect(closedWith).toBeUndefined());
    expect(document.querySelector('mat-dialog-container')).toBeNull();
  });
});
