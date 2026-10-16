import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subject, of } from 'rxjs';
import { SEARCH_DEBOUNCE_MS, TracksPageComponent } from './tracks-page';
import { CoverSearchDialogComponent } from './cover-search-dialog/cover-search-dialog';
import { ConfirmDeleteDialogComponent } from './confirm-delete-dialog/confirm-delete-dialog';
import { Page } from '../../shared/models/page.model';
import { Track } from '../../shared/models/track.model';

/**
 * Tests de la page « Ma bibliothèque » : suppression (mission 5), progression
 * d'upload (mission 6), pagination et affichage d'erreur (missions 2 et 7).
 *
 * `MatSnackBar` est remplacé par un double : cela garde le test unitaire (pas
 * d'overlay ni d'animations à monter sous jsdom) et permet surtout d'asserter
 * le *message* affiché, qui est un livrable explicite de la mission 5.
 * `MatDialog` est doublé de la même façon : `confirmWith(true|false)` simule
 * le choix de l'utilisateur dans le dialogue de confirmation (le vrai dialogue
 * est couvert par le bloc « dialogue de confirmation réel »).
 *
 * Attention : le constructeur du composant appelle `load()`, donc une première
 * requête `GET /api/tracks` part dès `createComponent()`.
 */
describe('TracksPageComponent', () => {
  function makeTrack(id: string, title = `Piste ${id}`): Track {
    return {
      id,
      title,
      originalName: `${id}.mp3`,
      mimeType: 'audio/mpeg',
      size: 2048,
      createdAt: '2026-01-01T00:00:00.000Z',
      artist: null,
      album: null,
      hasCover: false,
      coverSource: null,
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

  /** Fichier audio factice acceptable par la validation frontend. */
  function makeFile(name = 'morceau.mp3'): File {
    return new File(['octets-audio'], name, { type: 'audio/mpeg' });
  }

  let fixture: ComponentFixture<TracksPageComponent>;
  let component: TracksPageComponent;
  let httpMock: HttpTestingController;
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let dialog: { open: ReturnType<typeof vi.fn> };

  /** Simule la réponse de l'utilisateur au dialogue de confirmation. */
  function confirmWith(result: boolean | undefined | Observable<boolean | undefined>) {
    const afterClosed = result instanceof Observable ? result : of(result);
    dialog.open.mockReturnValue({ afterClosed: () => afterClosed });
  }

  /** Attend la requête de liste d'une page donnée et vérifie son URL réelle. */
  function expectListRequest(page = 1, limit = 5, q?: string) {
    const query = q === undefined ? '' : `&q=${encodeURIComponent(q)}`;
    return httpMock.expectOne(
      (request) =>
        request.method === 'GET' &&
        request.urlWithParams === `/api/tracks?page=${page}&limit=${limit}${query}`,
    );
  }

  function pendingGets() {
    return httpMock.match((candidate) => candidate.method === 'GET');
  }

  function text(selector: string): string {
    return (fixture.nativeElement.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Monte le composant et solde la requête de liste initiale déclenchée par le
   * constructeur, pour que chaque test parte d'un état connu.
   */
  function setup(initial: Page<Track> = makePage([makeTrack('t1')])) {
    snackBar = { open: vi.fn() };
    dialog = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: dialog },
      ],
    });

    fixture = TestBed.createComponent(TracksPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    expectListRequest(initial.page, initial.limit).flush(initial);
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  // --- Mission 5 : suppression ---------------------------------------------

  describe('remove() — suppression d’une piste', () => {
    it('n’émet AUCUNE requête DELETE si l’utilisateur refuse la confirmation', () => {
      setup(makePage([makeTrack('t1')]));
      confirmWith(false);

      component.remove(makeTrack('t1'));

      expect(dialog.open).toHaveBeenCalledOnce();
      // Preuve directe : aucune requête sur cette URL…
      httpMock.expectNone('/api/tracks/t1');
      // …et aucune requête en attente du tout (le `verify()` de afterEach le
      // confirme aussi, y compris un éventuel rechargement de liste parasite).
      expect(httpMock.match(() => true)).toHaveLength(0);
      expect(component.deletingId()).toBe('');
    });

    it('appelle DELETE /api/tracks/:id puis recharge la liste après confirmation', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));
      confirmWith(true);

      component.remove(makeTrack('t1'));

      const deleteRequest = httpMock.expectOne('/api/tracks/t1');
      expect(deleteRequest.request.method).toBe('DELETE');
      expect(component.deletingId()).toBe('t1');

      // Réponse réelle du backend : 204 sans corps.
      deleteRequest.flush(null, { status: 204, statusText: 'No Content' });

      expect(component.deletingId()).toBe('');
      // Le rechargement est l'exigence « recharge la liste » de la mission 7.
      expectListRequest(1).flush(makePage([makeTrack('t2')], { total: 1 }));
      expect(component.tracks().map((track) => track.id)).toEqual(['t2']);
    });

    it('affiche un message de succès après une suppression réussie', () => {
      setup(makePage([makeTrack('t1', 'Blues en La')]));
      confirmWith(true);

      component.remove(makeTrack('t1', 'Blues en La'));
      httpMock.expectOne('/api/tracks/t1').flush(null, { status: 204, statusText: 'No Content' });
      expectListRequest(1).flush(makePage([]));

      expect(snackBar.open).toHaveBeenCalledOnce();
      expect(snackBar.open.mock.calls[0][0]).toContain('Blues en La');
    });

    it('traite un 404 (piste supprimée ailleurs) par un message, sans planter', () => {
      setup(makePage([makeTrack('t1')]));
      confirmWith(true);

      component.remove(makeTrack('t1'));
      // Corps réel du backend pour ce cas.
      httpMock
        .expectOne('/api/tracks/t1')
        .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

      expect(component.deletingId()).toBe('');
      expect(snackBar.open).toHaveBeenCalledOnce();
      expect(snackBar.open.mock.calls[0][0]).toBe('Piste introuvable ou déjà supprimée.');

      // La liste est resynchronisée malgré l'échec : c'est ce qui fait
      // disparaître de l'écran une piste supprimée dans un autre onglet.
      expectListRequest(1).flush(makePage([]));
      expect(component.tracks()).toEqual([]);
    });

    it('ignore un second clic pendant la suppression en cours (deletingId)', () => {
      setup(makePage([makeTrack('t1')]));
      confirmWith(true);

      component.remove(makeTrack('t1'));
      const deleteRequest = httpMock.expectOne('/api/tracks/t1');
      expect(component.deletingId()).toBe('t1');

      // Second clic pendant l'appel : il doit sortir avant même la confirmation.
      component.remove(makeTrack('t1'));

      expect(dialog.open).toHaveBeenCalledOnce();
      expect(httpMock.match('/api/tracks/t1')).toHaveLength(0);

      deleteRequest.flush(null, { status: 204, statusText: 'No Content' });
      expectListRequest(1).flush(makePage([]));
    });

    it('désactive le bouton Supprimer de la piste en cours de suppression', () => {
      setup(makePage([makeTrack('t1')]));
      confirmWith(true);

      const button: HTMLButtonElement = fixture.nativeElement.querySelector('button.delete');
      expect(button.disabled).toBe(false);

      button.click();
      fixture.detectChanges();

      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');

      httpMock.expectOne('/api/tracks/t1').flush(null, { status: 204, statusText: 'No Content' });
      expectListRequest(1).flush(makePage([]));
    });
  });

  // --- Mission 6 : progression d'upload ------------------------------------

  describe('upload() — progression', () => {
    /** Démarre un upload et rend la requête POST en attente. */
    function startUpload() {
      component.file.set(makeFile());
      component.upload();

      const request = httpMock.expectOne(
        (candidate) => candidate.method === 'POST' && candidate.url === '/api/tracks',
      );
      expect(component.uploading()).toBe(true);
      // Au démarrage, aucun octet mesuré : état indéterminé, pas 0 %.
      expect(component.uploadProgress()).toBeNull();

      return request;
    }

    it('convertit les événements UploadProgress en pourcentage', () => {
      setup();
      const request = startUpload();

      request.event({ type: HttpEventType.UploadProgress, loaded: 25, total: 100 });
      expect(component.uploadProgress()).toBe(25);

      request.event({ type: HttpEventType.UploadProgress, loaded: 70, total: 200 });
      expect(component.uploadProgress()).toBe(35);

      request.event(new HttpResponse({ body: makeTrack('t9') }));
      expectListRequest(1).flush(makePage([makeTrack('t9')]));
    });

    it('reste en indéterminé (null) quand l’événement n’annonce pas de total', () => {
      setup();
      const request = startUpload();

      request.event({ type: HttpEventType.UploadProgress, loaded: 40, total: 100 });
      expect(component.uploadProgress()).toBe(40);

      // Total absent : mieux vaut l'indéterminé qu'un faux pourcentage.
      request.event({ type: HttpEventType.UploadProgress, loaded: 60 });
      expect(component.uploadProgress()).toBeNull();

      request.event(new HttpResponse({ body: makeTrack('t9') }));
      expectListRequest(1).flush(makePage([makeTrack('t9')]));
    });

    it('ne déclare PAS la réussite à 100 % des octets transmis (seul Response la prouve)', () => {
      setup();
      const request = startUpload();

      request.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });

      // Point pédagogique central de la mission 6 : tous les octets sont partis,
      // mais le serveur n'a pas encore répondu — rien n'est acquis.
      expect(component.uploadProgress()).toBe(100);
      expect(component.uploadSuccess()).toBe('');
      expect(component.uploading()).toBe(true);
      // Aucun rechargement de liste n'a été déclenché à ce stade.
      expect(httpMock.match((candidate) => candidate.method === 'GET')).toHaveLength(0);

      // C'est seulement maintenant que la réussite est établie.
      request.event(new HttpResponse({ body: makeTrack('t9', 'Nouveau morceau') }));

      expect(component.uploading()).toBe(false);
      expect(component.uploadProgress()).toBeNull();
      expect(component.uploadSuccess()).toContain('Nouveau morceau');
      expect(component.file()).toBeUndefined();
      // Retour en page 1 pour voir la piste fraîchement ajoutée.
      expect(component.page()).toBe(1);
      expectListRequest(1).flush(makePage([makeTrack('t9')]));
    });

    it('remet l’état à plat en cas d’échec d’upload', () => {
      setup();
      const request = startUpload();

      request.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
      expect(component.uploadProgress()).toBe(50);

      request.flush({ message: 'Fichier trop volumineux' }, { status: 413, statusText: 'Payload Too Large' });

      expect(component.uploading()).toBe(false);
      expect(component.uploadProgress()).toBeNull();
      expect(component.uploadSuccess()).toBe('');
      // Message du backend réutilisé tel quel.
      expect(component.uploadError()).toBe('Fichier trop volumineux');
      // Le titre est réactivé, sinon le formulaire resterait inutilisable.
      expect(component.title.disabled).toBe(false);
    });

    it('ignore une seconde soumission pendant un envoi en cours', () => {
      setup();
      const request = startUpload();

      component.upload();
      component.upload();

      // Une seule requête POST, malgré trois appels à upload().
      expect(httpMock.match((candidate) => candidate.method === 'POST')).toHaveLength(0);

      request.event(new HttpResponse({ body: makeTrack('t9') }));
      expectListRequest(1).flush(makePage([makeTrack('t9')]));
    });

    it('refuse d’envoyer sans fichier sélectionné et n’émet aucune requête', () => {
      setup();

      component.upload();

      expect(httpMock.match((candidate) => candidate.method === 'POST')).toHaveLength(0);
      expect(component.uploading()).toBe(false);
      expect(component.uploadError()).toBe('Choisissez un fichier audio avant d’envoyer.');
    });
  });

  // --- Mission 2 : pagination, et mission 7 : erreur affichée --------------

  describe('pagination', () => {
    it('go(2) émet GET /api/tracks?page=2&limit=5', () => {
      setup(makePage([makeTrack('t1')], { page: 1, pages: 3, total: 11 }));

      component.go(2);

      expectListRequest(2).flush(makePage([makeTrack('t6')], { page: 2, pages: 3, total: 11 }));
      expect(component.page()).toBe(2);
      expect(component.tracks().map((track) => track.id)).toEqual(['t6']);
    });

    it('n’émet aucune requête pour une page hors bornes', () => {
      setup(makePage([makeTrack('t1')], { page: 1, pages: 2, total: 6 }));

      component.go(0);
      component.go(-5);
      component.go(99);

      // Les bornes ramènent à 1 ou 2… mais go() sort si la cible est la page
      // courante ; seule une page réellement différente déclenche une requête.
      const requests = httpMock.match((candidate) => candidate.method === 'GET');
      expect(requests.filter((request) => request.request.params.get('page') === '1')).toHaveLength(
        0,
      );
      // go(99) est ramené à 2, qui est une page valide et différente : 1 requête.
      expect(requests).toHaveLength(1);
      requests[0].flush(makePage([makeTrack('t6')], { page: 2, pages: 2, total: 6 }));
    });

    it('ne relance pas la même page', () => {
      setup(makePage([makeTrack('t1')], { page: 1, pages: 3, total: 11 }));

      component.go(1);

      expect(httpMock.match((candidate) => candidate.method === 'GET')).toHaveLength(0);
    });

    it('ignore la réponse d’un chargement rendu obsolète par un plus récent', () => {
      // Deux load() peuvent se chevaucher (suppression confirmée pendant un
      // changement de page). Si la réponse la plus ancienne arrive en dernier,
      // elle ne doit pas écraser l'état affiché par la plus récente.
      setup(makePage([makeTrack('t1')], { page: 1, pages: 2, total: 6 }));

      component.go(2);
      const premier = expectListRequest(2);
      component.load();
      const second = expectListRequest(2);

      second.flush(makePage([makeTrack('recent')], { page: 2, pages: 2, total: 6 }));
      premier.flush(makePage([makeTrack('perime')], { page: 2, pages: 2, total: 6 }));

      expect(component.tracks().map((track) => track.id)).toEqual(['recent']);
      expect(component.loading()).toBe(false);
    });
  });

  describe('erreur HTTP sur le chargement de la liste', () => {
    it('renseigne le signal error et l’affiche dans le DOM', () => {
      snackBar = { open: vi.fn() };
      dialog = { open: vi.fn() };
      TestBed.configureTestingModule({
        imports: [TracksPageComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: MatSnackBar, useValue: snackBar },
          { provide: MatDialog, useValue: dialog },
        ],
      });

      fixture = TestBed.createComponent(TracksPageComponent);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);

      expectListRequest(1).flush(
        { message: 'Service indisponible' },
        { status: 503, statusText: 'Service Unavailable' },
      );
      fixture.detectChanges();

      expect(component.error()).toBe('Service indisponible');
      expect(component.loading()).toBe(false);
      expect(component.tracks()).toEqual([]);

      // Exigence mission 7 : l'erreur est réellement visible par l'utilisateur.
      const alert: HTMLElement | null = fixture.nativeElement.querySelector('p.error[role="alert"]');
      expect(alert).toBeTruthy();
      expect(alert?.textContent).toContain('Service indisponible');
    });
  });

  // --- Lecture audio : nettoyage des ObjectURL -----------------------------

  describe('nettoyage des ObjectURL', () => {
    it('révoque l’URL précédente au changement de piste et la dernière à la destruction', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));

      let counter = 0;
      const createSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockImplementation(() => `blob:fake-${++counter}`);
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      component.play(makeTrack('t1'));
      httpMock
        .expectOne('/api/tracks/t1/audio')
        .flush(new Blob(['a'], { type: 'audio/mpeg' }));
      expect(component.audioUrl()).toBe('blob:fake-1');
      expect(revokeSpy).not.toHaveBeenCalled();

      component.play(makeTrack('t2'));
      httpMock
        .expectOne('/api/tracks/t2/audio')
        .flush(new Blob(['b'], { type: 'audio/mpeg' }));

      // La première ObjectURL est libérée, sinon le Blob resterait retenu.
      expect(revokeSpy).toHaveBeenCalledWith('blob:fake-1');
      expect(component.audioUrl()).toBe('blob:fake-2');

      fixture.destroy();

      expect(revokeSpy).toHaveBeenCalledWith('blob:fake-2');
      expect(revokeSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenCalledTimes(2);
    });

    it('affiche un message si le chargement de l’audio échoue', () => {
      setup(makePage([makeTrack('t1', 'Blues en La')]));

      component.play(makeTrack('t1', 'Blues en La'));
      httpMock
        .expectOne('/api/tracks/t1/audio')
        .flush(new Blob(['{}']), { status: 404, statusText: 'Not Found' });

      expect(component.audioLoadingId()).toBe('');
      expect(component.audioError()).toContain('Blues en La');
      expect(component.audioUrl()).toBe('');
    });
  });

  // --- Bonus : filtre par titre (paramètre serveur `q`) --------------------

  describe('filtre par titre', () => {
    afterEach(() => vi.useRealTimers());

    function type(value: string) {
      component.search.setValue(value);
    }

    it('n’interroge le serveur qu’après 300 ms d’inactivité, avec q', () => {
      vi.useFakeTimers();
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));

      type('b');
      vi.advanceTimersByTime(100);
      type('bl');
      vi.advanceTimersByTime(100);
      type('blues');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(pendingGets()).toHaveLength(0);

      vi.advanceTimersByTime(1);
      // Une seule requête, pour la dernière saisie uniquement.
      expectListRequest(1, 5, 'blues').flush(makePage([makeTrack('b1')], { total: 1 }));
      expect(component.query()).toBe('blues');
      expect(component.tracks().map((track) => track.id)).toEqual(['b1']);
    });

    it('revient en page 1 à chaque nouveau filtre', () => {
      vi.useFakeTimers();
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));
      component.go(2);
      expectListRequest(2).flush(makePage([makeTrack('t6')], { page: 2, total: 11, pages: 3 }));
      expect(component.page()).toBe(2);

      type('  blues ');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

      // Valeur rognée, page forcée à 1 et non à la page courante (2).
      expectListRequest(1, 5, 'blues').flush(makePage([makeTrack('b1')], { total: 1 }));
      expect(component.page()).toBe(1);
    });

    it('annule (switchMap) la requête d’un filtre devenu périmé', () => {
      vi.useFakeTimers();
      setup();

      type('bl');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      const stale = expectListRequest(1, 5, 'bl');

      type('blues');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      const fresh = expectListRequest(1, 5, 'blues');

      expect(stale.cancelled).toBe(true);
      expect(fresh.cancelled).toBe(false);
      fresh.flush(makePage([makeTrack('b1')], { total: 1 }));
      expect(component.tracks().map((track) => track.id)).toEqual(['b1']);
      expect(component.loading()).toBe(false);
    });

    it('ne relance pas de requête si le filtre rogné est inchangé', () => {
      vi.useFakeTimers();
      setup();

      type('   ');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

      expect(pendingGets()).toHaveLength(0);
    });

    it('conserve q lors de la pagination et du rechargement', () => {
      vi.useFakeTimers();
      setup();
      type('blues');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expectListRequest(1, 5, 'blues').flush(makePage([makeTrack('b1')], { total: 8, pages: 2 }));

      component.go(2);
      expectListRequest(2, 5, 'blues').flush(makePage([makeTrack('b6')], { page: 2, total: 8, pages: 2 }));

      component.load();
      expectListRequest(2, 5, 'blues').flush(makePage([makeTrack('b6')], { page: 2, total: 8, pages: 2 }));
    });

    it('« Effacer » vide le champ et recharge aussitôt sans q, une seule fois', () => {
      vi.useFakeTimers();
      setup();
      type('blues');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expectListRequest(1, 5, 'blues').flush(makePage([], { total: 0 }));
      fixture.detectChanges();

      const clear: HTMLButtonElement = fixture.nativeElement.querySelector('button.clear');
      expect(clear.getAttribute('aria-label')).toBe('Effacer le filtre');
      clear.click();

      // Immédiat : pas d'attente de l'anti-rebond.
      expectListRequest(1).flush(makePage([makeTrack('t1')]));
      expect(component.search.value).toBe('');
      expect(component.query()).toBe('');

      // L'émission différée de la saisie vide ne relance rien.
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(pendingGets()).toHaveLength(0);
    });

    it('expose un champ de recherche étiqueté dans une région role="search"', () => {
      setup();

      const input: HTMLInputElement = fixture.nativeElement.querySelector(
        '[role="search"] input[type="search"]',
      );
      expect(input).toBeTruthy();
      const label = fixture.nativeElement.querySelector(`label[for="${input.id}"]`);
      expect(label?.textContent).toContain('Filtrer par titre');
      expect(input.getAttribute('maxlength')).toBe('100');
    });
  });

  describe('états vides et annonces', () => {
    it('distingue « aucun résultat pour le filtre » de « bibliothèque vide »', () => {
      vi.useFakeTimers();
      setup(makePage([makeTrack('t1')]));

      component.search.setValue('zzz');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expectListRequest(1, 5, 'zzz').flush(makePage([], { total: 0, pages: 0 }));
      fixture.detectChanges();

      expect(text('.empty-search')).toContain('Aucune piste ne correspond à “zzz”');
      expect(fixture.nativeElement.querySelector('.empty-library')).toBeNull();
      vi.useRealTimers();
    });

    it('affiche l’état « bibliothèque vide » sans filtre', () => {
      setup(makePage([], { total: 0, pages: 0 }));

      expect(text('.empty-library')).toContain('Votre bibliothèque est vide');
      expect(fixture.nativeElement.querySelector('.empty-search')).toBeNull();
      // Aucun paginator pour une liste vide.
      expect(fixture.nativeElement.querySelector('mat-paginator')).toBeNull();
    });

    it('annonce le nombre de pistes trouvées dans une région aria-live polie', () => {
      vi.useFakeTimers();
      setup();

      component.search.setValue('blues');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expectListRequest(1, 5, 'blues').flush(
        makePage([makeTrack('b1'), makeTrack('b2'), makeTrack('b3')], { total: 3 }),
      );
      fixture.detectChanges();

      const regions: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.library [aria-live="polite"]'),
      );
      expect(regions.some((region) => region.textContent?.includes('3 pistes trouvées pour « blues »'))).toBe(
        true,
      );
      expect(component.resultsAnnouncement()).toBe('3 pistes trouvées pour « blues ».');
      vi.useRealTimers();
    });

    it('accorde l’annonce au singulier et à zéro', () => {
      vi.useFakeTimers();
      setup();

      component.search.setValue('solo');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expectListRequest(1, 5, 'solo').flush(makePage([makeTrack('s1')], { total: 1 }));
      expect(component.resultsAnnouncement()).toBe('1 piste trouvée pour « solo ».');

      component.search.setValue('rien');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expectListRequest(1, 5, 'rien').flush(makePage([], { total: 0, pages: 0 }));
      expect(component.resultsAnnouncement()).toBe('Aucune piste trouvée pour « rien ».');
      vi.useRealTimers();
    });

    it('affiche des squelettes pendant le premier chargement, masqués aux lecteurs d’écran', () => {
      dialog = { open: vi.fn() };
      TestBed.configureTestingModule({
        imports: [TracksPageComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: MatSnackBar, useValue: { open: vi.fn() } },
          { provide: MatDialog, useValue: dialog },
        ],
      });
      fixture = TestBed.createComponent(TracksPageComponent);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();

      const skeletons = fixture.nativeElement.querySelectorAll('.skeleton-card');
      expect(skeletons).toHaveLength(5);
      expect(skeletons[0].closest('ul').getAttribute('aria-hidden')).toBe('true');

      expectListRequest(1).flush(makePage([makeTrack('t1')]));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.skeleton-card')).toHaveLength(0);
      // Emplacement réservé à la future UI des pochettes.
      expect(fixture.nativeElement.querySelector('.track-card .cover-slot')).toBeTruthy();
    });
  });

  // --- Bonus : MatPaginator ------------------------------------------------

  describe('MatPaginator', () => {
    function paginator(): MatPaginator {
      return fixture.debugElement.query(By.directive(MatPaginator)).componentInstance;
    }

    function navButton(kind: 'next' | 'previous' | 'first' | 'last'): HTMLButtonElement {
      return fixture.nativeElement.querySelector(`.mat-mdc-paginator-navigation-${kind}`);
    }

    /** `disabledInteractive` : Material garde le focus et pose `aria-disabled`. */
    function isDisabled(kind: 'next' | 'previous' | 'first' | 'last'): boolean {
      return navButton(kind).getAttribute('aria-disabled') === 'true';
    }

    /** Le constructeur charge toujours la page 1 : on navigue ensuite en page 2. */
    function setupOnPage2() {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));
      component.go(2);
      expectListRequest(2).flush(makePage([makeTrack('t6')], { page: 2, total: 11, pages: 3 }));
      fixture.detectChanges();
    }

    it('reflète total, page et taille du serveur (pageIndex = page - 1)', () => {
      setupOnPage2();

      expect(paginator().length).toBe(11);
      expect(paginator().pageIndex).toBe(1);
      expect(paginator().pageSize).toBe(5);
      expect(paginator().pageSizeOptions).toEqual([5, 10, 20]);
    });

    it('affiche des libellés français', () => {
      setupOnPage2();

      expect(text('.mat-mdc-paginator-range-label')).toBe('6 – 10 sur 11');
      expect(text('.mat-mdc-paginator-page-size-label')).toBe('Pistes par page :');
      expect(navButton('next').getAttribute('aria-label')).toBe('Page suivante');
      expect(navButton('previous').getAttribute('aria-label')).toBe('Page précédente');
      expect(navButton('first').getAttribute('aria-label')).toBe('Première page');
      expect(navButton('last').getAttribute('aria-label')).toBe('Dernière page');
    });

    it('« Page suivante » émet une requête serveur pour la page 2', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));

      navButton('next').click();

      expectListRequest(2).flush(makePage([makeTrack('t6')], { page: 2, total: 11, pages: 3 }));
      fixture.detectChanges();
      expect(component.page()).toBe(2);
      expect(paginator().pageIndex).toBe(1);
    });

    it('« Dernière page » demande directement la dernière page', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));

      navButton('last').click();

      expectListRequest(3).flush(makePage([makeTrack('t11')], { page: 3, total: 11, pages: 3 }));
    });

    it('désactive Précédent/Première en page 1 et Suivant/Dernière en dernière page', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));
      expect(isDisabled('previous')).toBe(true);
      expect(isDisabled('first')).toBe(true);
      expect(isDisabled('next')).toBe(false);

      component.go(3);
      expectListRequest(3).flush(makePage([makeTrack('t11')], { page: 3, total: 11, pages: 3 }));
      fixture.detectChanges();

      expect(isDisabled('next')).toBe(true);
      expect(isDisabled('last')).toBe(true);
      expect(isDisabled('previous')).toBe(false);
    });

    it('est désactivé pendant un chargement', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));

      component.load();
      fixture.detectChanges();
      expect(paginator().disabled).toBe(true);
      expect(isDisabled('next')).toBe(true);

      expectListRequest(1).flush(makePage([makeTrack('t1')], { total: 11, pages: 3 }));
      fixture.detectChanges();
      expect(paginator().disabled).toBe(false);
    });

    it('un changement de taille revient en page 1 avec le nouveau limit', () => {
      setupOnPage2();

      paginator()._changePageSize(10);

      expectListRequest(1, 10).flush(makePage([makeTrack('t1')], { limit: 10, total: 11, pages: 2 }));
      fixture.detectChanges();
      expect(component.limit()).toBe(10);
      expect(component.page()).toBe(1);
      expect(paginator().pageIndex).toBe(0);
      expect(paginator().pageSize).toBe(10);
    });

    it('n’émet qu’une requête par changement, jamais de découpage local', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));

      component.onPage({ pageIndex: 1, previousPageIndex: 0, pageSize: 5, length: 11 });
      // Ignoré : chargement en cours (paginator désactivé).
      component.onPage({ pageIndex: 2, previousPageIndex: 1, pageSize: 5, length: 11 });
      component.onPage({ pageIndex: 0, previousPageIndex: 1, pageSize: 20, length: 11 });

      const requests = pendingGets();
      expect(requests).toHaveLength(1);
      expect(requests[0].request.urlWithParams).toBe('/api/tracks?page=2&limit=5');
      requests[0].flush(makePage([makeTrack('t6')], { page: 2, total: 11, pages: 3 }));
    });
  });

  // --- Bonus : dialogue de confirmation ------------------------------------

  describe('dialogue de confirmation', () => {
    it('ouvre un alertdialog avec le titre de la piste', () => {
      setup(makePage([makeTrack('t1', 'Blues en La')]));
      confirmWith(false);

      component.remove(makeTrack('t1', 'Blues en La'));

      const [, config] = dialog.open.mock.calls[0];
      expect(config.data).toEqual({ title: 'Blues en La' });
      expect(config.role).toBe('alertdialog');
      expect(config.restoreFocus).toBe(true);
    });

    it('ignore un second clic tant que le dialogue est ouvert', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));
      const closed = new Subject<boolean | undefined>();
      confirmWith(closed);

      component.remove(makeTrack('t1'));
      component.remove(makeTrack('t2'));
      expect(dialog.open).toHaveBeenCalledOnce();

      // Fermeture par Échap / clic extérieur : `undefined`, donc aucune requête.
      closed.next(undefined);
      closed.complete();
      expect(httpMock.match(() => true)).toHaveLength(0);

      // Le dialogue fermé, un nouveau clic est de nouveau accepté.
      confirmWith(false);
      component.remove(makeTrack('t2'));
      expect(dialog.open).toHaveBeenCalledTimes(2);
    });
  });

  describe('dialogue de confirmation réel (MatDialog)', () => {
    function setupWithRealDialog() {
      snackBar = { open: vi.fn() };
      TestBed.configureTestingModule({
        imports: [TracksPageComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: MatSnackBar, useValue: snackBar },
          // Animations coupées : fermeture synchrone et déterministe sous jsdom.
          { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ],
      });
      fixture = TestBed.createComponent(TracksPageComponent);
      component = fixture.componentInstance;
      httpMock = TestBed.inject(HttpTestingController);
      expectListRequest(1).flush(makePage([makeTrack('t1', 'Blues en La')]));
      fixture.detectChanges();
    }

    function openDialog(): HTMLElement {
      fixture.nativeElement.querySelector('button.delete').click();
      fixture.detectChanges();
      const container = document.querySelector<HTMLElement>('mat-dialog-container');
      expect(container).toBeTruthy();
      return container as HTMLElement;
    }

    function dialogButton(container: HTMLElement, label: string): HTMLButtonElement {
      const button = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      expect(button).toBeTruthy();
      return button as HTMLButtonElement;
    }

    afterEach(() => TestBed.inject(MatDialog).closeAll());

    it('est un alertdialog modal, titré et décrit, avec des libellés explicites', async () => {
      setupWithRealDialog();
      const container = openDialog();
      // `mat-dialog-title` renseigne aria-labelledby de façon asynchrone.
      await fixture.whenStable();
      fixture.detectChanges();

      expect(container.getAttribute('role')).toBe('alertdialog');
      expect(container.getAttribute('aria-modal')).toBe('true');
      const titleId = container.getAttribute('aria-labelledby');
      expect(document.getElementById(titleId ?? '')?.textContent).toContain('Supprimer cette piste ?');
      expect(container.getAttribute('aria-describedby')).toBe('confirm-delete-description');
      expect(container.textContent).toContain('Blues en La');
      expect(dialogButton(container, 'Annuler')).toBeTruthy();
      expect(dialogButton(container, 'Supprimer').getAttribute('aria-label')).toBe(
        'Supprimer définitivement Blues en La',
      );
    });

    it('« Annuler » ferme le dialogue sans aucune requête DELETE', async () => {
      setupWithRealDialog();
      const container = openDialog();

      dialogButton(container, 'Annuler').click();
      await fixture.whenStable();

      expect(document.querySelector('mat-dialog-container')).toBeNull();
      httpMock.expectNone((request) => request.method === 'DELETE');
      expect(component.deletingId()).toBe('');
    });

    it('« Supprimer » émet DELETE puis recharge la liste', async () => {
      setupWithRealDialog();
      const container = openDialog();

      dialogButton(container, 'Supprimer').click();
      await fixture.whenStable();

      httpMock.expectOne('/api/tracks/t1').flush(null, { status: 204, statusText: 'No Content' });
      expectListRequest(1).flush(makePage([]));
      expect(snackBar.open.mock.calls[0][0]).toContain('Blues en La');
    });
  });

  // --- Vague 2 : pochettes -------------------------------------------------

  describe('pochette optionnelle à l’upload', () => {
    function png(name = 'pochette.png', size = 10): File {
      return new File([new Uint8Array(size)], name, { type: 'image/png' });
    }

    function mockObjectUrls() {
      let counter = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++counter}`);
      return vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }

    function postedBody(): FormData {
      const request = httpMock.expectOne(
        (candidate) => candidate.method === 'POST' && candidate.url === '/api/tracks',
      );
      const body = request.request.body as FormData;
      request.event(new HttpResponse({ body: makeTrack('t9') }));
      expectListRequest(1).flush(makePage([makeTrack('t9')]));
      return body;
    }

    it('n’ajoute pas de champ cover sans image choisie', () => {
      setup();
      component.file.set(makeFile());
      component.upload();

      expect(postedBody().has('cover')).toBe(false);
    });

    it('envoie cover, affiche l’aperçu puis réinitialise tout après succès', () => {
      setup();
      const revokeSpy = mockObjectUrls();
      component.file.set(makeFile());
      component.selectCover(png());
      fixture.detectChanges();

      const preview: HTMLImageElement = fixture.nativeElement.querySelector('.cover-preview img');
      expect(preview.getAttribute('src')).toBe('blob:preview-1');
      expect(preview.getAttribute('alt')).toBe('Aperçu de la pochette pochette.png');

      component.upload();
      const body = postedBody();

      expect((body.get('cover') as File).name).toBe('pochette.png');
      expect(component.coverFile()).toBeUndefined();
      expect(component.coverPreviewUrl()).toBe('');
      expect(revokeSpy).toHaveBeenCalledWith('blob:preview-1');
    });

    it.each([
      ['image/gif', () => new File(['gif'], 'anim.gif', { type: 'image/gif' }), 'Formats autorisés : JPEG, PNG, WebP'],
      ['plus de 2 Mo', () => png('lourde.png', 2 * 1024 * 1024 + 1), '2 Mo maximum'],
    ])('refuse une image invalide (%s) avec un message clair', (_label, makeImage, message) => {
      setup();
      mockObjectUrls();

      component.selectCover(makeImage());
      fixture.detectChanges();

      expect(component.coverFile()).toBeUndefined();
      expect(component.coverPreviewUrl()).toBe('');
      expect(component.coverError()).toContain(message);
      const error: HTMLElement = fixture.nativeElement.querySelector('#cover-error[role="alert"]');
      expect(error.textContent).toContain(message);
      expect(fixture.nativeElement.querySelector('#track-cover').getAttribute('aria-invalid')).toBe('true');
    });

    it('« Retirer l’image » révoque l’aperçu et l’upload repart sans cover', () => {
      setup();
      const revokeSpy = mockObjectUrls();
      component.selectCover(png());
      fixture.detectChanges();

      fixture.nativeElement.querySelector('button.clear-cover').click();

      expect(revokeSpy).toHaveBeenCalledWith('blob:preview-1');
      expect(component.coverFile()).toBeUndefined();
      component.file.set(makeFile());
      component.upload();
      expect(postedBody().has('cover')).toBe(false);
    });

    it('révoque l’aperçu à la destruction de la page', () => {
      setup();
      const revokeSpy = mockObjectUrls();
      component.selectCover(png());

      fixture.destroy();

      expect(revokeSpy).toHaveBeenCalledWith('blob:preview-1');
    });
  });

  describe('affichage des métadonnées de pochette', () => {
    it('affiche artiste/album présents, jamais « null », et la source de la pochette', () => {
      setup(
        makePage([
          { ...makeTrack('t1'), artist: 'Kevin MacLeod', album: null, hasCover: true, coverSource: 'id3' },
        ]),
      );
      // La pochette est demandée par le composant enfant : absente ici.
      httpMock
        .expectOne('/api/tracks/t1/cover')
        .flush(new Blob(['{}']), { status: 404, statusText: 'Not Found' });

      expect(text('.track-artist')).toBe('Kevin MacLeod');
      expect(text('.track-card')).not.toContain('null');
      const badge = text('.source-badge');
      expect(badge).toContain('Source de la pochette :');
      expect(badge).toContain('Tags ID3');
    });

    it('n’affiche ni ligne artiste ni badge sans métadonnées', () => {
      setup();

      expect(fixture.nativeElement.querySelector('.track-artist')).toBeNull();
      expect(fixture.nativeElement.querySelector('.source-badge')).toBeNull();
      expect(fixture.nativeElement.querySelector('button.remove-cover')).toBeNull();
    });
  });

  describe('actions de pochette sur une card', () => {
    const IMAGE_URL = 'https://is1-ssl.mzstatic.com/image/a.jpg';
    const jpeg = () => new File([new Uint8Array(10)], 'nouvelle.jpg', { type: 'image/jpeg' });

    function listRequests() {
      return httpMock.match((candidate) => candidate.method === 'GET' && candidate.url === '/api/tracks');
    }

    it('« Chercher sur le Web » : POST /cover/web puis remplacement en place, sans rechargement', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));
      dialog.open.mockReturnValue({ afterClosed: () => of({ id: 'a', imageUrl: IMAGE_URL }) });

      component.searchCover(makeTrack('t2'));

      expect(dialog.open.mock.calls[0][0]).toBe(CoverSearchDialogComponent);
      expect(dialog.open.mock.calls[0][1].data).toEqual({ trackId: 't2', title: 'Piste t2' });
      const request = httpMock.expectOne('/api/tracks/t2/cover/web');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ imageUrl: IMAGE_URL });
      expect(component.coverBusyId()).toBe('t2');

      request.flush({ ...makeTrack('t2'), hasCover: true, coverSource: 'web' } satisfies Track);

      expect(component.coverBusyId()).toBe('');
      expect(component.tracks().map((track) => [track.id, track.coverSource])).toEqual([
        ['t1', null],
        ['t2', 'web'],
      ]);
      expect(component.coverVersion('t2')).toBe(1);
      expect(listRequests()).toHaveLength(0);
      expect(snackBar.open.mock.calls[0][0]).toContain('Piste t2');
    });

    it('fermer la recherche sans choix n’émet aucune requête', () => {
      setup();
      dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });

      component.searchCover(makeTrack('t1'));

      expect(httpMock.match(() => true)).toHaveLength(0);
      expect(component.coverBusyId()).toBe('');
    });

    it('« Changer la pochette » : PUT puis remplacement en place sans saut de page', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));
      component.go(2);
      expectListRequest(2).flush(makePage([makeTrack('t6')], { page: 2, total: 11, pages: 3 }));

      component.changeCover(makeTrack('t6'), jpeg());

      const request = httpMock.expectOne('/api/tracks/t6/cover');
      expect(request.request.method).toBe('PUT');
      expect(((request.request.body as FormData).get('cover') as File).name).toBe('nouvelle.jpg');
      request.flush({ ...makeTrack('t6'), hasCover: true, coverSource: 'upload' } satisfies Track);

      expect(component.page()).toBe(2);
      expect(component.tracks()[0].coverSource).toBe('upload');
      expect(listRequests()).toHaveLength(0);
    });

    it('le sélecteur partagé transmet le fichier choisi à la bonne piste', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));
      const picker: HTMLInputElement = fixture.nativeElement.querySelector('input[aria-hidden="true"][type="file"]');
      const clickSpy = vi.spyOn(picker, 'click').mockImplementation(() => undefined);

      fixture.nativeElement.querySelectorAll('button.change-cover')[1].click();
      expect(clickSpy).toHaveBeenCalledOnce();

      component.onCoverPicked({ target: { files: [jpeg()], value: 'x' } } as unknown as Event);

      httpMock
        .expectOne('/api/tracks/t2/cover')
        .flush({ ...makeTrack('t2'), hasCover: true, coverSource: 'upload' } satisfies Track);
    });

    it('refuse localement une image invalide, sans requête', () => {
      setup();

      component.changeCover(makeTrack('t1'), new File(['x'], 'doc.pdf', { type: 'application/pdf' }));

      expect(httpMock.match(() => true)).toHaveLength(0);
      expect(snackBar.open.mock.calls[0][0]).toContain('Formats autorisés');
    });

    it('« Retirer la pochette » demande confirmation, puis DELETE et mise à jour locale', () => {
      setup(makePage([{ ...makeTrack('t1'), hasCover: true, coverSource: 'web' }]));
      httpMock
        .expectOne('/api/tracks/t1/cover')
        .flush(new Blob(['{}']), { status: 404, statusText: 'Not Found' });
      confirmWith(true);

      fixture.nativeElement.querySelector('button.remove-cover').click();

      expect(dialog.open.mock.calls[0][0]).toBe(ConfirmDeleteDialogComponent);
      expect(dialog.open.mock.calls[0][1].data).toEqual({ title: 'Piste t1', target: 'cover' });
      const request = httpMock.expectOne(
        (candidate) => candidate.method === 'DELETE' && candidate.url === '/api/tracks/t1/cover',
      );
      request.flush(null, { status: 204, statusText: 'No Content' });

      expect(component.tracks()[0].hasCover).toBe(false);
      expect(component.tracks()[0].coverSource).toBeNull();
      expect(listRequests()).toHaveLength(0);
    });

    it('annuler le retrait de pochette n’émet aucune requête', () => {
      setup();
      confirmWith(false);

      component.removeCover(makeTrack('t1'));

      expect(httpMock.match(() => true)).toHaveLength(0);
    });

    it('ignore les doubles clics pendant une opération et désactive les boutons (aria-busy)', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));

      component.changeCover(makeTrack('t1'), jpeg());
      const pending = httpMock.expectOne('/api/tracks/t1/cover');
      component.changeCover(makeTrack('t1'), jpeg());
      component.searchCover(makeTrack('t2'));
      component.removeCover(makeTrack('t2'));
      fixture.detectChanges();

      expect(httpMock.match(() => true)).toHaveLength(0);
      expect(dialog.open).not.toHaveBeenCalled();
      const card: HTMLElement = fixture.nativeElement.querySelector('.track-card');
      expect(card.getAttribute('aria-busy')).toBe('true');
      const coverButtons: HTMLButtonElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.cover-actions button'),
      );
      expect(coverButtons.every((button) => button.disabled)).toBe(true);
      expect((card.querySelector('button.delete') as HTMLButtonElement).disabled).toBe(true);

      pending.flush({ ...makeTrack('t1'), hasCover: false } satisfies Track);
      fixture.detectChanges();
      expect(coverButtons.every((button) => !button.disabled)).toBe(true);
    });

    it('ignore un second « Chercher sur le Web » tant que le dialogue est ouvert', () => {
      setup();
      const closed = new Subject<undefined>();
      dialog.open.mockReturnValue({ afterClosed: () => closed });

      component.searchCover(makeTrack('t1'));
      component.searchCover(makeTrack('t1'));

      expect(dialog.open).toHaveBeenCalledOnce();
      closed.next(undefined);
      closed.complete();
    });

    it('un 404 (piste disparue) affiche un message et resynchronise la liste', () => {
      setup();

      component.changeCover(makeTrack('t1'), jpeg());
      httpMock
        .expectOne('/api/tracks/t1/cover')
        .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

      expect(component.coverBusyId()).toBe('');
      expect(snackBar.open.mock.calls[0][0]).toBe('Piste introuvable ou déjà supprimée.');
      expectListRequest(1).flush(makePage([]));
    });

    it('la suppression d’une piste libère l’ObjectURL de sa pochette', () => {
      setup(makePage([{ ...makeTrack('t1'), hasCover: true, coverSource: 'id3' }]));
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:cover-t1');
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      httpMock.expectOne('/api/tracks/t1/cover').flush(new Blob(['img'], { type: 'image/jpeg' }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.cover-slot img').getAttribute('src')).toBe('blob:cover-t1');

      confirmWith(true);
      component.remove(makeTrack('t1'));
      httpMock.expectOne('/api/tracks/t1').flush(null, { status: 204, statusText: 'No Content' });
      expectListRequest(1).flush(makePage([]));
      fixture.detectChanges();

      expect(revokeSpy).toHaveBeenCalledWith('blob:cover-t1');
    });
  });

  // --- Relecture : page hors bornes, extension absente, focus --------------

  describe('page devenue hors bornes (pistes supprimées ailleurs)', () => {
    function onPage2Then(response: Page<Track>) {
      setup(makePage([makeTrack('t1')], { total: 6, pages: 2 }));
      component.go(2);
      expectListRequest(2).flush(makePage([makeTrack('t6')], { page: 2, total: 6, pages: 2 }));
      component.load();
      expectListRequest(2).flush(response);
    }

    it('bascule sur la dernière page valide et recharge une fois', () => {
      onPage2Then(makePage([], { page: 2, total: 5, pages: 1 }));

      expect(component.page()).toBe(1);
      expect(component.total()).toBe(5);
      expectListRequest(1).flush(makePage([makeTrack('t1')], { total: 5, pages: 1 }));
      fixture.detectChanges();

      expect(component.tracks().map((track) => track.id)).toEqual(['t1']);
      expect(text('.library')).not.toContain('Votre bibliothèque est vide');
    });

    it('ne boucle jamais : un second résultat hors bornes n’entraîne aucune autre requête', () => {
      setup(makePage([makeTrack('t1')], { total: 11, pages: 3 }));
      component.go(3);
      expectListRequest(3).flush(makePage([makeTrack('t11')], { page: 3, total: 11, pages: 3 }));
      component.load();
      // Suppressions concurrentes : la page 3 a disparu, puis la page 2 aussi.
      expectListRequest(3).flush(makePage([], { page: 3, total: 7, pages: 2 }));
      expectListRequest(2).flush(makePage([], { page: 2, total: 4, pages: 1 }));
      fixture.detectChanges();

      expect(pendingGets()).toHaveLength(0);
      expect(component.loading()).toBe(false);
      // Des pistes existent : on n'affiche pas « bibliothèque vide ».
      expect(fixture.nativeElement.querySelector('.empty-library')).toBeNull();
      expect(text('.empty-page')).toContain('Cette page ne contient plus de piste');

      fixture.nativeElement.querySelector('.empty-page button').click();
      expectListRequest(1).flush(makePage([makeTrack('t1')], { total: 5, pages: 1 }));
    });

    it('n’applique pas de repli quand la bibliothèque est réellement vide', () => {
      onPage2Then(makePage([], { page: 2, total: 0, pages: 0 }));
      fixture.detectChanges();

      expect(pendingGets()).toHaveLength(0);
      expect(text('.empty-library')).toContain('Votre bibliothèque est vide');
    });
  });

  describe('fichier audio sans extension', () => {
    it('annonce « type inconnu » plutôt que le dernier caractère du nom', () => {
      setup();
      component.file.set(new File(['octets'], 'morceau', { type: '' }));

      component.upload();

      expect(component.uploadError()).toContain('type inconnu');
      expect(component.uploadError()).not.toContain('(u)');
      expect(httpMock.match((candidate) => candidate.method === 'POST')).toHaveLength(0);
    });
  });

  describe('focus après suppression', () => {
    it('déplace le focus sur le titre de la liste quand la card disparaît', () => {
      setup(makePage([makeTrack('t1'), makeTrack('t2')], { total: 2 }));
      confirmWith(true);
      const deleteButton: HTMLButtonElement = fixture.nativeElement.querySelector('button.delete');
      deleteButton.focus();

      deleteButton.click();
      httpMock.expectOne('/api/tracks/t1').flush(null, { status: 204, statusText: 'No Content' });
      expectListRequest(1).flush(makePage([makeTrack('t2')], { total: 1 }));
      fixture.detectChanges();

      const heading: HTMLElement = fixture.nativeElement.querySelector('#library-heading');
      expect(heading.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(heading);
    });
  });
});

