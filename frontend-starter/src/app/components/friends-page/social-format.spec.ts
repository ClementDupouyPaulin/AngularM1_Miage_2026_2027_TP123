import { fullDate, initials, monthYear, relativeTime } from './social-format';

describe('relativeTime', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('dit « à l’instant » sous 45 secondes et pour une date légèrement future', () => {
    expect(relativeTime(ago(10_000), now)).toBe('à l’instant');
    expect(relativeTime(ago(-5_000), now)).toBe('à l’instant');
  });

  it('compte en minutes, heures, jours', () => {
    expect(relativeTime(ago(50_000), now)).toBe('il y a 1 minute');
    expect(relativeTime(ago(5 * MINUTE), now)).toBe('il y a 5 minutes');
    expect(relativeTime(ago(3 * HOUR), now)).toBe('il y a 3 heures');
    expect(relativeTime(ago(DAY + HOUR), now)).toBe('hier');
    expect(relativeTime(ago(3 * DAY), now)).toBe('il y a 3 jours');
  });

  it('passe aux semaines, mois et années', () => {
    expect(relativeTime(ago(15 * DAY), now)).toBe('il y a 2 semaines');
    expect(relativeTime(ago(65 * DAY), now)).toBe('il y a 2 mois');
    expect(relativeTime(ago(800 * DAY), now)).toBe('il y a 2 ans');
  });

  it('renvoie une chaîne vide pour une date invalide', () => {
    expect(relativeTime('pas une date', now)).toBe('');
  });
});

describe('initials', () => {
  it('prend les initiales des deux premiers mots', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('jean-luc godard')).toBe('JL');
    expect(initials('  Grace ')).toBe('G');
    expect(initials('élodie bernard martin')).toBe('ÉB');
  });

  it('a un repli pour un nom vide', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('formats de date', () => {
  it('formate mois et année, et la date complète', () => {
    expect(monthYear('2026-03-15T10:00:00.000Z')).toBe('mars 2026');
    expect(fullDate('2026-03-15T10:00:00.000Z')).toContain('2026');
    expect(monthYear('invalide')).toBe('');
  });
});
