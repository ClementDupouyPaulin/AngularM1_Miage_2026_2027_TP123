import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Clip, ClipAnalysis, ClipSummary } from '../models/clip.model';
import { Page } from '../models/page.model';

/**
 * Encapsulates all HTTP operations for film clips.
 * Aucun composant n'injecte `HttpClient` : toute la frontière HTTP est ici.
 */
@Injectable({ providedIn: 'root' })
export class ClipService {
  private readonly http = inject(HttpClient);

  /** `q` n'est envoyé que s'il reste non vide une fois rogné. */
  list(page = 1, limit = 5, q?: string): Observable<Page<ClipSummary>> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    const query = q?.trim();
    if (query) params = params.set('q', query);
    return this.http.get<Page<ClipSummary>>('/api/clips', { params });
  }

  get(id: string): Observable<Clip> {
    return this.http.get<Clip>(`/api/clips/${id}`);
  }

  /**
   * Multipart `video`, `title` et `analysis` (JSON sérialisé : un champ
   * multipart ne transporte que du texte). Flux d'événements pour la progression.
   */
  upload(file: File, title: string, analysis: ClipAnalysis): Observable<HttpEvent<Clip>> {
    const body = new FormData();
    body.append('video', file);
    body.append('title', title);
    body.append('analysis', JSON.stringify(analysis));
    return this.http.post<Clip>('/api/clips', body, {
      observe: 'events',
      reportProgress: true,
    });
  }

  /** Octets vidéo en `Blob` via `HttpClient`, donc avec l'en-tête JWT de l'intercepteur. */
  video(id: string): Observable<Blob> {
    return this.http.get(`/api/clips/${id}/video`, { responseType: 'blob' });
  }

  /** Suppression d'un extrait : `204 No Content` côté backend. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/clips/${id}`);
  }
}
