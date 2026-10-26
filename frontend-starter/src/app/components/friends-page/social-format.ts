const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
/** En deçà, « à l'instant » (couvre aussi un léger décalage d'horloge vers le futur). */
const JUST_NOW_MS = 45 * SECOND;

const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const FULL_DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const STEPS: readonly [limit: number, unit: Intl.RelativeTimeFormatUnit, size: number][] = [
  [HOUR, 'minute', MINUTE],
  [DAY, 'hour', HOUR],
  [WEEK, 'day', DAY],
  [MONTH, 'week', WEEK],
  [YEAR, 'month', MONTH],
  [Infinity, 'year', YEAR],
];

/** Date relative en français (« il y a 5 minutes », « hier »…). Chaîne vide si la date est invalide. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const elapsed = now - time;
  if (elapsed < JUST_NOW_MS) return 'à l’instant';
  for (const [limit, unit, size] of STEPS) {
    if (elapsed < limit) return RELATIVE.format(-Math.max(1, Math.floor(elapsed / size)), unit);
  }
  return '';
}

/** « octobre 2026 » : pour « Ami depuis… ». */
export function monthYear(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : MONTH_YEAR.format(time);
}

/** Date complète, pour l'infobulle des dates relatives. */
export function fullDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : FULL_DATE.format(time);
}

/** Initiales de l'avatar : premières lettres des deux premiers mots (« Ada Lovelace » → « AL »). */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase('fr') || '?';
}
