import {
  DRIFT_TOLERANCE_SEC,
  MIN_PLAYBACK_RATE,
  hasEndedAt,
  playbackRateFor,
  positionFromSideTime,
  referenceSide,
  RESYNC_COOLDOWN_MS,
  followerResync,
  resyncTarget,
  targetTime,
} from './transport';

describe('transport de la comparaison', () => {
  it('calcule le temps cible en mode absolu (borné à la durée du côté)', () => {
    expect(targetTime(12, 'absolute', 30, 60)).toBe(12);
    expect(targetTime(45, 'absolute', 30, 60)).toBe(30);
    expect(targetTime(-3, 'absolute', 30, 60)).toBe(0);
    expect(targetTime(90, 'absolute', 60, 60)).toBe(60);
  });

  it('calcule le temps cible en mode relatif (même pourcentage)', () => {
    expect(targetTime(30, 'relative', 30, 60)).toBe(15);
    expect(targetTime(60, 'relative', 30, 60)).toBe(30);
    expect(targetTime(30, 'relative', 60, 60)).toBe(30);
    expect(targetTime(10, 'relative', 0, 60)).toBe(0);
    expect(targetTime(Number.NaN, 'relative', 30, 60)).toBe(0);
  });

  it('retrouve la position commune depuis le temps d’un côté', () => {
    expect(positionFromSideTime(12, 'absolute', 30, 60)).toBe(12);
    expect(positionFromSideTime(15, 'relative', 30, 60)).toBe(30);
    expect(positionFromSideTime(45, 'relative', 30, 60)).toBe(60);
    expect(positionFromSideTime(5, 'relative', 30, 0)).toBe(0);
    for (const mode of ['absolute', 'relative'] as const) {
      expect(targetTime(positionFromSideTime(9, mode, 30, 60), mode, 30, 60)).toBeCloseTo(9);
    }
  });

  it('ralentit le plus court en mode relatif, garde la vitesse commune en mode absolu', () => {
    expect(playbackRateFor(1.5, 'absolute', 30, 60)).toBe(1.5);
    expect(playbackRateFor(1, 'relative', 30, 60)).toBe(0.5);
    expect(playbackRateFor(2, 'relative', 60, 60)).toBe(2);
    expect(playbackRateFor(0.5, 'relative', 1, 600)).toBe(MIN_PLAYBACK_RATE);
  });

  it('termine chaque côté indépendamment', () => {
    expect(hasEndedAt(29, 'absolute', 30, 60)).toBe(false);
    expect(hasEndedAt(30, 'absolute', 30, 60)).toBe(true);
    expect(hasEndedAt(45, 'relative', 30, 60)).toBe(false);
    expect(hasEndedAt(60, 'relative', 30, 60)).toBe(true);
    expect(hasEndedAt(0, 'absolute', 0, 60)).toBe(true);
  });

  it('ne recale le suiveur qu’au-delà de la tolérance et seulement en lecture', () => {
    expect(DRIFT_TOLERANCE_SEC).toBe(0.15);
    expect(resyncTarget(10.1, 10, true)).toBeNull();
    expect(resyncTarget(10.2, 10, true)).toBe(10);
    expect(resyncTarget(9.7, 10, true)).toBe(10);
    expect(resyncTarget(5, 10, false)).toBeNull();
    expect(resyncTarget(Number.NaN, 10, true)).toBeNull();
  });

  it('prend le plus long comme référence, A en cas d’égalité', () => {
    expect(referenceSide({ a: 30, b: 60 })).toBe('b');
    expect(referenceSide({ a: 60, b: 30 })).toBe('a');
    expect(referenceSide({ a: 30, b: 30 })).toBe('a');
  });

  describe('followerResync', () => {
    const playing = { time: 9.5, playing: true, seeking: false };

    it('recale un suiveur en lecture qui dérive', () => {
      expect(followerResync(playing, 10, 1000, null)).toBe(10);
    });

    it('ne recale pas pendant un déplacement en cours', () => {
      expect(followerResync({ ...playing, seeking: true }, 10, 1000, null)).toBeNull();
    });

    it('attend la temporisation après un recalage', () => {
      expect(followerResync(playing, 10, 1000 + RESYNC_COOLDOWN_MS - 1, 1000)).toBeNull();
      expect(followerResync(playing, 10, 1000 + RESYNC_COOLDOWN_MS, 1000)).toBe(10);
    });

    it('respecte la tolérance et l’arrêt', () => {
      expect(followerResync({ ...playing, time: 9.9 }, 10, 1000, null)).toBeNull();
      expect(followerResync({ ...playing, playing: false }, 10, 1000, null)).toBeNull();
    });
  });
});
