import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CoverSearchResult } from '../models/cover-search-result.model';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';

/**
 * Encapsulates all HTTP operations for backing tracks.
 * Aucun composant n'injecte `HttpClient` : toute la frontière HTTP est ici.
 */
@Injectable({ providedIn: 'root' })
export class TrackService {
  private readonly http = inject(HttpClient);

  /**
   * Pagination serveur : `page` et `limit` partent en query params et le
   * backend ne renvoie que la tranche demandée (`GET /api/tracks?page=..&limit=..`).
   * `q` filtre par titre côté serveur ; il n'est envoyé que s'il reste non vide
   * une fois rogné, pour ne pas transformer « aucun filtre » en `q=`.
   */
  list(page = 1, limit = 5, q?: string): Observable<Page<Track>> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    const query = q?.trim();
    if (query) params = params.set('q', query);
    return this.http.get<Page<Track>>('/api/tracks', { params });
  }

  /**
   * Envoi multipart avec exactement les champs attendus par le backend :
   * `audio` (le fichier, lu par `upload.single("audio")`), `title` et, seulement
   * si elle est fournie, l'image `cover` (sinon le backend lit les tags ID3).
   *
   * `observe: 'events'` + `reportProgress: true` exposent le flux complet
   * d'événements HTTP (`UploadProgress` puis `Response`), ce qui permettra
   * d'afficher une barre de progression sans changer cette signature.
   */
  upload(file: File, title: string, cover?: File): Observable<HttpEvent<Track>> {
    const body = new FormData();
    body.append('audio', file);
    body.append('title', title);
    if (cover) body.append('cover', cover);
    return this.http.post<Track>('/api/tracks', body, {
      observe: 'events',
      reportProgress: true,
    });
  }

  /**
   * Récupère les octets audio en `Blob`. Cet appel passe par `HttpClient`,
   * donc par l'intercepteur qui ajoute l'en-tête `Authorization: Bearer ...`,
   * ce qu'un `src` pointant directement l'URL ne ferait pas.
   */
  audio(id: string): Observable<Blob> {
    return this.http.get(`/api/tracks/${id}/audio`, {
      responseType: 'blob',
    });
  }

  /** Suppression d'une piste : `204 No Content` côté backend. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/tracks/${id}`);
  }

  /** Octets de la pochette (`404` si la piste n'en a pas), via l'intercepteur JWT. */
  cover(id: string): Observable<Blob> {
    return this.http.get(`/api/tracks/${id}/cover`, { responseType: 'blob' });
  }

  /** Remplace la pochette par une image envoyée en multipart (champ `cover`). */
  setCover(id: string, file: File): Observable<Track> {
    const body = new FormData();
    body.append('cover', file);
    return this.http.put<Track>(`/api/tracks/${id}/cover`, body);
  }

  /** Retire la pochette : `204 No Content` côté backend. */
  removeCover(id: string): Observable<void> {
    return this.http.delete<void>(`/api/tracks/${id}/cover`);
  }

  /** Recherche de pochettes sur le Web, lancée uniquement sur action explicite. */
  searchCover(id: string): Observable<CoverSearchResult> {
    return this.http.get<CoverSearchResult>(`/api/tracks/${id}/cover/search`);
  }

  /** Adopte une pochette trouvée sur le Web ; le backend télécharge et valide l'image. */
  setCoverFromWeb(id: string, imageUrl: string): Observable<Track> {
    return this.http.post<Track>(`/api/tracks/${id}/cover/web`, { imageUrl });
  }
}
