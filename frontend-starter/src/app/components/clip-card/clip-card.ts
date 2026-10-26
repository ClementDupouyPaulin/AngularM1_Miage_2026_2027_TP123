import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { rhythmFromAverageShotLength } from '../../shared/analysis/rhythm';
import { ClipSummary } from '../../shared/models/clip.model';
import { ClipService } from '../../shared/services/clip.service';
import { formatTimecode } from '../pulse-timeline/chart-math';
import { SparklineComponent } from '../sparkline/sparkline';
import { VISIBILITY_LABELS, formatDecimal, isSynced, syncScoreLabel } from './clip-format';

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

  readonly rhythm = computed(() => {
    const clip = this.clip();
    return rhythmFromAverageShotLength(clip.cutCount > 0 ? clip.avgShotLength : Number.POSITIVE_INFINITY);
  });
  readonly timecode = computed(() => formatTimecode(this.clip().durationSec));
  readonly synced = computed(() => isSynced(this.clip().syncScore));
  readonly syncLabel = computed(() => syncScoreLabel(this.clip().syncScore));
  readonly syncValue = computed(() => {
    const score = this.clip().syncScore;
    return score === null ? '—' : `×${formatDecimal(score, 1)}`;
  });
  readonly visibilityLabel = computed(() => VISIBILITY_LABELS[this.clip().visibility]);
  readonly sparklineLabel = computed(
    () => `Densité des coupes de « ${this.clip().title} » au fil de l’extrait, ${this.clip().cutCount} coupes`,
  );

  constructor() {
    effect((onCleanup) => {
      const id = this.posterId();
      this.posterUrl.set('');
      if (!id) return;
      let url = '';
      const subscription = this.service.filmstrip(id).subscribe({
        next: (blob) => {
          url = URL.createObjectURL(blob);
          this.posterUrl.set(url);
        },
        error: () => console.debug('[Studio] Affiche indisponible, repli en dégradé'),
      });
      onCleanup(() => {
        subscription.unsubscribe();
        if (url) URL.revokeObjectURL(url);
      });
    });
  }
}
