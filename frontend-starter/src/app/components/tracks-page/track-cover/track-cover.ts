import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, tap } from 'rxjs';
import { Track } from '../../../shared/models/track.model';
import { TrackService } from '../../../shared/services/track.service';

/** Ce qui détermine réellement l'image à afficher (le reste de `Track` n'y change rien). */
interface CoverRequest {
  id: string;
  hasCover: boolean;
  version: number;
}

/**
 * Pochette d'une piste. L'image passe par `HttpClient` (et donc par
 * l'intercepteur JWT), puis par une ObjectURL : un `<img src>` pointant
 * directement l'API partirait sans en-tête `Authorization`.
 */
@Component({
  selector: 'app-track-cover',
  templateUrl: './track-cover.html',
  styleUrl: './track-cover.css',
})
export class TrackCoverComponent {
  private readonly service = inject(TrackService);

  readonly track = input.required<Track>();
  /**
   * Clé de version incrémentée par le parent après chaque modification : la
   * route `/cover` est identique avant et après, seule cette clé force le
   * rechargement de l'image.
   */
  readonly version = input(0);

  readonly url = signal('');
  readonly loading = signal(false);

  private readonly request = computed<CoverRequest>(
    () => ({ id: this.track().id, hasCover: this.track().hasCover, version: this.version() }),
    {
      equal: (a, b) => a.id === b.id && a.hasCover === b.hasCover && a.version === b.version,
    },
  );

  constructor() {
    toObservable(this.request)
      .pipe(
        // L'ancienne image est libérée dès que la demande change, avant même
        // que la nouvelle n'arrive.
        tap(() => this.revoke()),
        switchMap(({ id, hasCover }) => {
          this.loading.set(hasCover);
          if (!hasCover) return of(null);
          return this.service.cover(id).pipe(
            catchError((error: unknown) => {
              console.warn('[TrackCover] Pochette indisponible', id, error);
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (blob) => {
          this.loading.set(false);
          if (blob) this.url.set(URL.createObjectURL(blob));
        },
        error: (error: unknown) => {
          console.error('[TrackCover] Flux de pochette interrompu', error);
          this.loading.set(false);
        },
      });

    inject(DestroyRef).onDestroy(() => this.revoke());
  }

  /** Image illisible malgré un 200 : on retombe sur le visuel de remplacement. */
  onImageError(): void {
    console.warn('[TrackCover] Image de pochette illisible', this.track().id);
    this.revoke();
  }

  private revoke(): void {
    const url = this.url();
    if (!url) return;
    URL.revokeObjectURL(url);
    this.url.set('');
  }
}
