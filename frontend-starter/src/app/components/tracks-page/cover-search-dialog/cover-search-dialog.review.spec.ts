import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { CoverCandidate } from '../../../shared/models/cover-candidate.model';
import { CoverSearchResult } from '../../../shared/models/cover-search-result.model';
import { CoverSearchDialogComponent, CoverSearchDialogData } from './cover-search-dialog';

/**
 * Relecture indépendante : le backend filtre déjà `imageUrl` (https +
 * `*.mzstatic.com`), mais le dialogue affiche des chaînes reçues du réseau.
 * Ces tests verrouillent la défense en profondeur côté Angular : aucun schéma
 * exécutable dans `<img src>` et aucune injection HTML par les métadonnées.
 */
describe('CoverSearchDialogComponent (relecture indépendante)', () => {
  const SEARCH_URL = '/api/tracks/t1/cover/search';
  let httpMock: HttpTestingController;

  function openWith(results: CoverCandidate[]): HTMLElement {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(MatDialog).open<CoverSearchDialogComponent, CoverSearchDialogData>(
      CoverSearchDialogComponent,
      { data: { trackId: 't1', title: 'Blues' } },
    );
    TestBed.tick();
    const payload: CoverSearchResult = {
      query: 'Blues',
      source: 'iTunes Search API',
      attribution: 'Attribution',
      results,
    };
    httpMock.expectOne(SEARCH_URL).flush(payload);
    TestBed.tick();
    return document.querySelector('mat-dialog-container') as HTMLElement;
  }

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    httpMock.verify();
  });

  it('ne laisse aucun schéma javascript: dans les <img src> des candidats', () => {
    const container = openWith([
      {
        id: 'x',
        title: 'Titre',
        artist: 'Artiste',
        album: 'Album',
        imageUrl: 'javascript:window.__xss = true',
      },
    ]);

    const sources = Array.from(container.querySelectorAll('img')).map(
      (image) => image.getAttribute('src') ?? '',
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].toLowerCase().startsWith('javascript:')).toBe(false);
  });

  it('affiche titre, artiste et album hostiles comme du texte', () => {
    const hostile = '<img src=x onerror="window.__xss = true">';
    const container = openWith([
      { id: 'x', title: hostile, artist: hostile, album: hostile, imageUrl: 'https://is1-ssl.mzstatic.com/a.jpg' },
    ]);

    const candidates = container.querySelector('.candidates') as HTMLElement;
    // Seule la miniature légitime existe : aucun <img> injecté par les métadonnées.
    expect(candidates.querySelectorAll('img')).toHaveLength(1);
    expect(candidates.querySelector('[onerror]')).toBeNull();
    expect(candidates.textContent).toContain('<img src=x onerror=');
  });

  it('n’envoie pas de référent aux serveurs d’images tiers', () => {
    const container = openWith([
      { id: 'x', title: 'T', artist: 'A', album: 'B', imageUrl: 'https://is1-ssl.mzstatic.com/a.jpg' },
    ]);

    expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
