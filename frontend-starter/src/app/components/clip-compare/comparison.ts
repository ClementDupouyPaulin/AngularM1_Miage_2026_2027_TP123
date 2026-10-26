import { Clip } from '../../shared/models/clip.model';
import { RhythmProfile, RhythmTone, rhythmProfile } from '../../shared/analysis/rhythm';
import { SYNC_ALIGNED_THRESHOLD } from '../../shared/analysis/sync-score';
import { estimateTempo } from '../../shared/analysis/tempo';
import { formatTime } from '../pulse-timeline/pulse-timeline';
import { Side } from './transport';

export const SIDES: readonly Side[] = ['a', 'b'];

export const SIDE_LABELS: Record<Side, string> = { a: 'Extrait A', b: 'Extrait B' };

export interface ClipComparison {
  /** Côté au plan moyen le plus court, `null` en cas d'égalité. */
  nervous: Side | null;
  /** Rapport ASL du plus lent sur ASL du plus nerveux (≥ 1). */
  nervousRatio: number;
  /** Côté au score de synchro le plus haut, `null` si égalité ou aucun score. */
  synced: Side | null;
}

export interface ComparisonRow {
  label: string;
  values: string[];
  /** Côté mis en évidence par `badge`, `null` si aucun. */
  winner: Side | null;
  badge: string;
  /** Pictogramme décoratif accompagnant `badge`. */
  icon: string;
}

export interface SideProfile {
  rhythm: RhythmProfile;
  /** Tempo de la bande-son (BPM), `null` si trop peu de beats. */
  bpm: number | null;
  fadeCount: number;
}

export interface SyncInterpretation {
  value: string;
  verdict: string;
}

export const NERVOUS_BADGE = { label: 'Plus nerveux', icon: '⚡' } as const;
export const SYNCED_BADGE = { label: 'Plus calé sur la musique', icon: '♪' } as const;

/** Pastille associée à chaque ton de rythme (l'étiquette textuelle porte le sens). */
export const TONE_CHIPS: Record<RhythmTone, string> = {
  calm: 'chip-beat',
  steady: 'chip-success',
  brisk: 'chip-accent',
  intense: 'chip-rec',
};

export function formatDecimal(value: number, digits: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function otherSide(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

export function interpretSyncScore(score: number | null): SyncInterpretation {
  if (score === null || !Number.isFinite(score)) return { value: '—', verdict: 'Bande-son non analysable' };
  const value = `× ${formatDecimal(score, 2)}`;
  return score >= SYNC_ALIGNED_THRESHOLD
    ? { value, verdict: 'Calé sur la musique' }
    : { value, verdict: 'Sans lien avec la musique' };
}

export function sideProfile(clip: Clip): SideProfile {
  const { cuts, beats, durationSec, transitions } = clip.analysis;
  return {
    rhythm: rhythmProfile(cuts, durationSec),
    bpm: estimateTempo(beats),
    fadeCount: (transitions ?? []).filter((transition) => transition.kind === 'fade').length,
  };
}

export function formatBpm(bpm: number | null): string {
  return bpm === null ? '—' : `${Math.round(bpm)} BPM`;
}

/** Désigne le montage le plus nerveux (ASL le plus court) et le plus calé sur la musique. */
export function compareClips(a: Clip, b: Clip): ClipComparison {
  let nervous: Side | null = null;
  let nervousRatio = 1;
  if (a.avgShotLength > 0 && b.avgShotLength > 0 && a.avgShotLength !== b.avgShotLength) {
    nervous = a.avgShotLength < b.avgShotLength ? 'a' : 'b';
    nervousRatio = Math.max(a.avgShotLength, b.avgShotLength) / Math.min(a.avgShotLength, b.avgShotLength);
  }

  const scoreA = a.syncScore ?? -Infinity;
  const scoreB = b.syncScore ?? -Infinity;
  const synced: Side | null = scoreA === scoreB ? null : scoreA > scoreB ? 'a' : 'b';

  return { nervous, nervousRatio, synced };
}

/** Phrase de synthèse en français, ex. « A est 1,8× plus nerveux que B ». */
export function summarizeComparison(a: Clip, b: Clip): string {
  const clips: Record<Side, Clip> = { a, b };
  const { nervous, nervousRatio, synced } = compareClips(a, b);
  const name = (side: Side) => `${side.toUpperCase()} (« ${clips[side].title} »)`;

  const rhythm = nervous
    ? `${name(nervous)} est ${formatDecimal(nervousRatio, 1)}× plus nerveux que ${name(otherSide(nervous))}.`
    : 'Les deux extraits ont le même rythme de montage.';

  let sync: string;
  if (synced) {
    const score = (side: Side) => interpretSyncScore(clips[side].syncScore).value;
    sync = `${name(synced)} est le plus calé sur la musique (${score(synced)} contre ${score(otherSide(synced))}).`;
  } else if (a.syncScore === null) {
    sync = 'Aucune des deux bandes-son n’est analysable.';
  } else {
    sync = 'Les deux montages sont aussi calés l’un que l’autre sur la musique.';
  }
  return `${rhythm} ${sync}`;
}

/** Lignes du tableau comparatif, dans l'ordre d'affichage. */
export function comparisonRows(pair: Record<Side, Clip>): ComparisonRow[] {
  const comparison = compareClips(pair.a, pair.b);
  const profiles: Record<Side, SideProfile> = { a: sideProfile(pair.a), b: sideProfile(pair.b) };
  const cells = (format: (clip: Clip, profile: SideProfile) => string) =>
    SIDES.map((side) => format(pair[side], profiles[side]));
  const plain = (label: string, values: string[]): ComparisonRow => ({ label, values, winner: null, badge: '', icon: '' });
  const seconds = (value: number) => `${formatDecimal(value, 1)} s`;

  return [
    plain('Durée', cells((clip) => formatTime(clip.durationSec))),
    plain('Coupes', cells((clip) => String(clip.cutCount))),
    plain('Fondus', cells((_, profile) => String(profile.fadeCount))),
    {
      label: 'Plan moyen (ASL)',
      values: cells((clip) => seconds(clip.avgShotLength)),
      winner: comparison.nervous,
      badge: NERVOUS_BADGE.label,
      icon: NERVOUS_BADGE.icon,
    },
    plain('Plan médian', cells((_, profile) => seconds(profile.rhythm.medianShotLength))),
    plain('Coupes par minute', cells((_, profile) => formatDecimal(profile.rhythm.cutsPerMinute, 1))),
    plain('Profil de rythme', cells((_, profile) => profile.rhythm.label)),
    plain('BPM musique', cells((_, profile) => formatBpm(profile.bpm))),
    {
      label: 'Synchro coupes / musique',
      values: cells((clip) => {
        const sync = interpretSyncScore(clip.syncScore);
        return `${sync.value} · ${sync.verdict}`;
      }),
      winner: comparison.synced,
      badge: SYNCED_BADGE.label,
      icon: SYNCED_BADGE.icon,
    },
  ];
}
