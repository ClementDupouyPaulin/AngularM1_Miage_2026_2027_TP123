import { inject, Injectable } from "@angular/core";
import { HttpClient, HttpEvent, HttpParams } from "@angular/common/http";
import { Observable } from "rxjs";
import {
  Clip,
  ClipAnalysis,
  ClipAnnotation,
  ClipPatch,
  ClipSummary,
  ClipVisibility,
  DiscoverScope,
  DiscoverSort,
  LibraryStats,
  TagCount,
} from "../models/clip.model";
import { Page } from "../models/page.model";

/** Type MIME déduit de l'extension quand le navigateur laisse `File.type` vide. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export interface ClipListFilters {
  q?: string;
  tag?: string;
  visibility?: ClipVisibility;
}

export interface DiscoverOptions {
  scope: DiscoverScope;
  sort?: DiscoverSort;
  q?: string;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface UploadExtras {
  filmstrip?: Blob | null;
  tags?: string[];
  visibility?: ClipVisibility;
}

/** Ajoute le paramètre seulement s'il reste non vide une fois rogné. */
function setIfFilled(
  params: HttpParams,
  name: string,
  value: string | undefined,
): HttpParams {
  const trimmed = value?.trim();
  return trimmed ? params.set(name, trimmed) : params;
}

/** Le fichier tel quel s'il a un type, sinon une copie typée d'après son extension. */
export function withMimeType(file: File): File {
  if (file.type) return file;
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const type = MIME_BY_EXTENSION[extension];
  return type ? new File([file], file.name, { type }) : file;
}

/**
 * Encapsulates all HTTP operations for film clips.
 * Aucun composant n'injecte `HttpClient` : toute la frontière HTTP est ici.
 */
@Injectable({ providedIn: "root" })
export class ClipService {
  private readonly http = inject(HttpClient);

  list(
    page = 1,
    limit = 6,
    filters: ClipListFilters = {},
  ): Observable<Page<ClipSummary>> {
    let params = new HttpParams().set("page", page).set("limit", limit);
    params = setIfFilled(params, "q", filters.q);
    params = setIfFilled(params, "tag", filters.tag);
    params = setIfFilled(params, "visibility", filters.visibility);
    return this.http.get<Page<ClipSummary>>("/api/clips", { params });
  }

  stats(): Observable<LibraryStats> {
    return this.http.get<LibraryStats>("/api/clips/stats");
  }

  tags(): Observable<TagCount[]> {
    return this.http.get<TagCount[]>("/api/clips/tags");
  }

  discover(options: DiscoverOptions): Observable<Page<ClipSummary>> {
    let params = new HttpParams().set("scope", options.scope);
    params = setIfFilled(params, "sort", options.sort);
    params = setIfFilled(params, "q", options.q);
    params = setIfFilled(params, "tag", options.tag);
    if (options.page !== undefined) params = params.set("page", options.page);
    if (options.limit !== undefined)
      params = params.set("limit", options.limit);
    return this.http.get<Page<ClipSummary>>("/api/clips/discover", { params });
  }

  get(id: string): Observable<Clip> {
    return this.http.get<Clip>(`/api/clips/${id}`);
  }

  /**
   * Multipart `video`, `title` et `analysis` (JSON sérialisé : un champ
   * multipart ne transporte que du texte), plus pellicule, étiquettes et
   * visibilité si fournies. Flux d'événements pour la progression.
   */
  upload(
    file: File,
    title: string,
    analysis: ClipAnalysis,
    extras: UploadExtras = {},
  ): Observable<HttpEvent<Clip>> {
    const body = new FormData();
    body.append("video", withMimeType(file));
    body.append("title", title);
    body.append("analysis", JSON.stringify(analysis));
    if (extras.filmstrip)
      body.append("filmstrip", extras.filmstrip, "filmstrip.jpg");
    if (extras.tags?.length) body.append("tags", JSON.stringify(extras.tags));
    if (extras.visibility) body.append("visibility", extras.visibility);
    return this.http.post<Clip>("/api/clips", body, {
      observe: "events",
      reportProgress: true,
    });
  }

  /** Octets vidéo en `Blob` via `HttpClient`, donc avec l'en-tête JWT de l'intercepteur. */
  video(id: string): Observable<Blob> {
    return this.http.get(`/api/clips/${id}/video`, { responseType: "blob" });
  }

  filmstrip(id: string): Observable<Blob> {
    return this.http.get(`/api/clips/${id}/filmstrip`, {
      responseType: "blob",
    });
  }

  patch(id: string, changes: ClipPatch): Observable<Clip> {
    return this.http.patch<Clip>(`/api/clips/${id}`, changes);
  }

  updateAnalysis(id: string, analysis: ClipAnalysis): Observable<Clip> {
    return this.http.put<Clip>(`/api/clips/${id}/analysis`, analysis);
  }

  /** Suppression d'un extrait : `204 No Content` côté backend. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/clips/${id}`);
  }

  addAnnotation(
    id: string,
    annotation: { time: number; text: string },
  ): Observable<ClipAnnotation> {
    return this.http.post<ClipAnnotation>(
      `/api/clips/${id}/annotations`,
      annotation,
    );
  }

  removeAnnotation(id: string, annotationId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/clips/${id}/annotations/${annotationId}`,
    );
  }
}
