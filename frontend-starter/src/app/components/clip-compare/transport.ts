/**
 * Logique pure de la barre de transport commune aux deux lecteurs.
 * La position commune est exprimée en secondes sur l'échelle de référence
 * (durée du plus long extrait), comme le curseur des timelines.
 */

export type Side = 'a' | 'b';

/** `absolute` : même instant pour les deux ; `relative` : même pourcentage de chaque extrait. */
export type SyncMode = 'absolute' | 'relative';

/** Écart toléré entre le lecteur suiveur et sa cible avant de le recaler. */
export const DRIFT_TOLERANCE_SEC = 0.15;
/** Délai laissé au suiveur après un recalage pour terminer son déplacement avant d'en tenter un autre. */
export const RESYNC_COOLDOWN_MS = 400;

export const SPEED_OPTIONS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Bornes de `HTMLMediaElement.playbackRate` acceptées par les navigateurs. */
export const MIN_PLAYBACK_RATE = 0.0625;
export const MAX_PLAYBACK_RATE = 16;

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Temps à donner à un lecteur de durée `durationSec` pour la position commune `position`. */
export function targetTime(position: number, mode: SyncMode, durationSec: number, referenceSec: number): number {
  if (!isPositive(durationSec) || !isPositive(referenceSec)) return 0;
  const clamped = clampValue(Number.isFinite(position) ? position : 0, 0, referenceSec);
  return mode === 'absolute' ? Math.min(clamped, durationSec) : (clamped / referenceSec) * durationSec;
}

/** Inverse de `targetTime` : position commune correspondant au temps `time` d'un lecteur. */
export function positionFromSideTime(time: number, mode: SyncMode, durationSec: number, referenceSec: number): number {
  if (!isPositive(referenceSec)) return 0;
  const safe = Number.isFinite(time) ? time : 0;
  if (mode === 'absolute') return clampValue(safe, 0, referenceSec);
  return isPositive(durationSec) ? clampValue(safe / durationSec, 0, 1) * referenceSec : 0;
}

/** En mode relatif, l'extrait le plus court est ralenti pour finir en même temps que la référence. */
export function playbackRateFor(speed: number, mode: SyncMode, durationSec: number, referenceSec: number): number {
  if (mode === 'absolute' || !isPositive(durationSec) || !isPositive(referenceSec)) return speed;
  return clampValue((speed * durationSec) / referenceSec, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE);
}

/** Vrai si le lecteur a atteint sa fin à la position commune `position` (fin de lecture indépendante). */
export function hasEndedAt(position: number, mode: SyncMode, durationSec: number, referenceSec: number): boolean {
  if (!isPositive(durationSec)) return true;
  return mode === 'absolute' ? position >= durationSec : position >= referenceSec;
}

/** Nouveau temps à imposer au lecteur suiveur, ou `null` s'il est assez proche ou à l'arrêt. */
export function resyncTarget(
  actual: number,
  target: number,
  playing: boolean,
  tolerance = DRIFT_TOLERANCE_SEC,
): number | null {
  if (!playing || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  return Math.abs(actual - target) > tolerance ? target : null;
}

export interface FollowerState {
  time: number;
  playing: boolean;
  seeking: boolean;
}

/**
 * Comme `resyncTarget`, mais sans recalage pendant un déplacement en cours ni
 * avant `cooldownMs` après le précédent (`lastResyncMs` = `null` si aucun).
 */
export function followerResync(
  follower: FollowerState,
  target: number,
  nowMs: number,
  lastResyncMs: number | null,
  cooldownMs = RESYNC_COOLDOWN_MS,
): number | null {
  if (follower.seeking) return null;
  if (lastResyncMs !== null && nowMs - lastResyncMs < cooldownMs) return null;
  return resyncTarget(follower.time, target, follower.playing);
}

/** Côté de référence (horloge maîtresse) : le plus long, A en cas d'égalité. */
export function referenceSide(durations: Record<Side, number>): Side {
  return durations.b > durations.a ? 'b' : 'a';
}
