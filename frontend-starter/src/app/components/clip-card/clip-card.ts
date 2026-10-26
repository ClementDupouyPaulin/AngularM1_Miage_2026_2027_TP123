import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { rhythmFromAverageShotLength } from '../../shared/analysis/rhythm';
import { VISIBILITY_LABELS, formatSyncScore, isSynced, syncScoreLabel } from '../../shared/format/clip-format';
import { ClipSummary } from '../../shared/models/clip.model';
import { ClipService } from '../../shared/services/clip.service';
import { formatTimecode } from '../pulse-timeline/chart-math';
import { SparklineComponent } from '../sparkline/sparkline';

/** Marge d'anticipation : l'affiche se charge un peu avant que la carte n'entre à l'écran. */
const POSTER_ROOT_MARGIN = '200px';

/** Carte d'un extrait, partagée par Studio et Découvrir : affiche, mini-courbe, rythme, synchro, étiquettes. */
@Component({
  selector: 'app-clip-card',
  imports: [SparklineComponent],
  templateUrl: './clip-card.html',
  styleUrl: './clip-card.css',
  host: { '[class.selected]': 'selected()' },
})
export class ClipCardComponent {
  private readonly service = inject(ClipService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly clip = input.required<ClipSummary>();
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly showOwner = input(false);
  readonly deletable = input(false);

  readonly open = output<ClipSummary>();
  readonly toggleSelect = output<ClipSummary>();
  readonly remove = output<ClipSummary>();

  /** ObjectURL du sprite de pellicule ; vide = affiche en dégradé. */
  readonly posterUrl = signal('');

  /** Identifiant dont on charge la pellicule (vide sans pellicule) : une nouvelle référence du même clip ne recharge pas. */
  private readonly posterId = computed(() => (this.clip().hasFilmstrip ? this.clip().id : ''));
  /** Carte visible (ou proche) à l'écran ; toujours vraie sans IntersectionObserver (ex. jsdom). */
  private readonly inView = signal(typeof IntersectionObserver === 'undefined');
  /** Clip dont `posterUrl` montre la pellicule (vide si aucune). */
  private posterFor = '';

  readonly rhythm = computed(() => {
    const clip = this.clip();
    return rhythmFromAverageShotLength(clip.cutCount > 0 ? clip.avgShotLength : Number.POSITIVE_INFINITY);
  });
  readonly timecode = computed(() => formatTimecode(this.clip().durationSec));
  readonly synced = computed(() => isSynced(this.clip().syncScore));
  readonly syncLabel = computed(() => syncScoreLabel(this.clip().syncScore));
  readonly syncValue = computed(() => formatSyncScore(this.clip().syncScore));
  readonly visibilityLabel = computed(() => VISIBILITY_LABELS[this.clip().visibility]);
  readonly sparklineLabel = computed(
    () => `Densité des coupes de « ${this.clip().title} » au fil de l’extrait, ${this.clip().cutCount} coupes`,
  );

  constructor() {
    this.observeVisibility();
    this.destroyRef.onDestroy(() => this.setPoster('', ''));

    effect((onCleanup) => {
      const id = this.posterId();
      const inView = this.inView();
      if (id !== this.posterFor) this.setPoster('', '');
      if (!id || !inView || this.posterFor === id) return;
      // Désabonnement = requête annulée si la carte quitte l'écran avant la réponse.
      const subscription = this.service.filmstrip(id).subscribe({
        next: (blob) => this.setPoster(id, URL.createObjectURL(blob)),
        error: () => console.debug('[Studio] Affiche indisponible, repli en dégradé'),
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  private observeVisibility(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) this.inView.set(entry.isIntersecting);
      },
      { rootMargin: POSTER_ROOT_MARGIN },
    );
    observer.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private setPoster(id: string, url: string): void {
    const previous = untracked(this.posterUrl);
    if (previous) URL.revokeObjectURL(previous);
    this.posterFor = id;
    this.posterUrl.set(url);
  }
}
