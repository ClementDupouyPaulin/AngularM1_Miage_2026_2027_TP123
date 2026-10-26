import {
  VISIBILITY_LABELS,
  formatDecimal,
  formatDuration,
  formatSyncScore,
  interpretSyncScore,
  isSynced,
  syncScoreLabel,
} from './clip-format';

describe('clip-format', () => {
  it('formate un décimal à la française avec le nombre de décimales demandé', () => {
    expect(formatDecimal(1.25, 1)).toBe('1,3');
    expect(formatDecimal(2.5, 2)).toBe('2,50');
    expect(formatDecimal(3, 0)).toBe('3');
  });

  it('formate une durée en m:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-4)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('affiche le score de synchro sous un format unique', () => {
    expect(formatSyncScore(1.274)).toBe('× 1,27');
    expect(formatSyncScore(null)).toBe('—');
    expect(formatSyncScore(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('interprète le score de synchro', () => {
    expect(interpretSyncScore(null)).toEqual({ value: '—', verdict: 'Bande-son non analysable' });
    expect(interpretSyncScore(1.02)).toEqual({ value: '× 1,02', verdict: 'Sans lien avec la musique' });
    expect(interpretSyncScore(2.5)).toEqual({ value: '× 2,50', verdict: 'Calé sur la musique' });
    expect(isSynced(2.5)).toBe(true);
    expect(isSynced(null)).toBe(false);
  });

  it('fournit un libellé de synchro en minuscules', () => {
    expect(syncScoreLabel(null)).toBe('bande-son non analysable');
    expect(syncScoreLabel(1)).toBe('sans lien avec la musique');
    expect(syncScoreLabel(2.4)).toBe('calé sur la musique');
  });

  it('expose un seul jeu de libellés de visibilité', () => {
    expect(VISIBILITY_LABELS).toEqual({ private: 'Privé', shared: 'Partagé avec des amis', public: 'Public' });
  });
});
