import {
  accelerationSeries,
  activeThumbnailIndex,
  axisTicks,
  cssUrl,
  cutDensity,
  densitySeries,
  formatPreciseTime,
  formatTime,
  formatTimecode,
  histogramBins,
  keyboardSeekTarget,
  linePath,
  nearestThumbnailIndex,
  paletteStops,
  pulsePoints,
  ratioToTime,
  shotLengths,
  smooth,
  spritePosition,
  timeToRatio,
} from './chart-math';

describe('chart-math : échelles et temps', () => {
  it('convertit temps et position relative en restant borné', () => {
    expect(timeToRatio(30, 120)).toBe(0.25);
    expect(timeToRatio(-5, 120)).toBe(0);
    expect(timeToRatio(500, 120)).toBe(1);
    expect(timeToRatio(10, 0)).toBe(0);
    expect(ratioToTime(0.5, 90)).toBe(45);
    expect(ratioToTime(1.4, 90)).toBe(90);
    expect(ratioToTime(0.5, Number.NaN)).toBe(0);
  });

  it('formate les temps en m:ss et m:ss,d', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatPreciseTime(12.44)).toBe('0:12,4');
    expect(formatPreciseTime(59.96)).toBe('1:00,0');
  });

  it('formate le code temporel mono', () => {
    expect(formatTimecode(0)).toBe('00:00');
    expect(formatTimecode(65.9)).toBe('01:05');
    expect(formatTimecode(12.44, true)).toBe('00:12,4');
    expect(formatTimecode(59.96, true)).toBe('01:00,0');
    expect(formatTimecode(3725)).toBe('01:02:05');
    expect(formatTimecode(Number.NaN)).toBe('00:00');
  });

  it('choisit un pas de graduation rond', () => {
    expect(axisTicks(60)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(axisTicks(7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(axisTicks(0)).toEqual([0]);
  });

  it('calcule la cible clavier d’un slider', () => {
    expect(keyboardSeekTarget('ArrowRight', 5, 60)).toBe(6);
    expect(keyboardSeekTarget('ArrowDown', 0.5, 60)).toBe(0);
    expect(keyboardSeekTarget('PageUp', 55, 60)).toBe(60);
    expect(keyboardSeekTarget('PageDown', 15, 60)).toBe(5);
    expect(keyboardSeekTarget('Home', 15, 60)).toBe(0);
    expect(keyboardSeekTarget('End', 15, 60)).toBe(60);
    expect(keyboardSeekTarget('a', 15, 60)).toBeNull();
  });
});

describe('chart-math : séries', () => {
  it('compte les coupes dans une fenêtre glissante de 5 s', () => {
    // Échantillons à 0, 5, 10, 15 et 20 s ; fenêtre [t - 2,5 ; t + 2,5[.
    expect(cutDensity([1, 2, 3, 20], 20, 4)).toEqual([2, 1, 0, 0, 1]);
    expect(cutDensity([], 10, 2)).toEqual([0, 0, 0]);
    expect(cutDensity([1], 0)).toEqual([]);
  });

  it('lisse par moyenne glissante tronquée aux bords', () => {
    expect(smooth([0, 3, 0], 1)).toEqual([1.5, 1, 1.5]);
    expect(smooth([1, 2], 0)).toEqual([1, 2]);
  });

  it('densitySeries = densité lissée', () => {
    const series = densitySeries([1, 2, 3, 20], 20, 4);
    expect(series).toHaveLength(5);
    expect(series).toEqual(smooth(cutDensity([1, 2, 3, 20], 20, 4)));
    expect(densitySeries([], 0)).toEqual([]);
  });

  it('place les points d’une série et les relie', () => {
    const points = pulsePoints([0, 2, 4], 4, 100, 0, 50);
    expect(points).toEqual([
      [0, 50],
      [50, 25],
      [100, 0],
    ]);
    expect(linePath(points)).toBe('M0 50 L50 25 L100 0');
    expect(pulsePoints([], 1)).toEqual([]);
  });

  it('découpe les plans entre les coupes', () => {
    expect(shotLengths([2, 2.5, 6], 10)).toEqual([2, 0.5, 3.5, 4]);
    expect(shotLengths([6, 2], 10)).toEqual([2, 4, 4]);
    expect(shotLengths([0, 10, 12], 10)).toEqual([10]);
    expect(shotLengths([], 8)).toEqual([8]);
    expect(shotLengths([1], 0)).toEqual([]);
  });

  it('répartit les durées dans les classes 0–1, 1–2, 2–4, 4–8, 8+', () => {
    const bins = histogramBins([0.5, 1, 1.9, 2, 3.99, 4, 8, 30]);
    expect(bins.map((bin) => bin.label)).toEqual(['0–1 s', '1–2 s', '2–4 s', '4–8 s', '8 s +']);
    expect(bins.map((bin) => bin.count)).toEqual([1, 2, 2, 1, 2]);
    expect(histogramBins([]).every((bin) => bin.count === 0)).toBe(true);
  });

  it('compte les coupes par fenêtre de 10 s, un point par seconde', () => {
    const series = accelerationSeries([1, 2, 3, 15], 20);
    expect(series).toHaveLength(21);
    expect(series[0]).toEqual({ time: 0, count: 3 });
    expect(series[10]).toEqual({ time: 10, count: 0 });
    expect(series[20]).toEqual({ time: 20, count: 1 });
    expect(accelerationSeries([1], 0)).toEqual([]);
    expect(accelerationSeries([], 3600)).toHaveLength(301);
  });
});

describe('chart-math : pellicule et palette', () => {
  it('trouve la vignette la plus proche, la plus ancienne en cas d’égalité', () => {
    expect(nearestThumbnailIndex([0, 4, 10], 6.5)).toBe(1);
    expect(nearestThumbnailIndex([0, 4, 10], 7)).toBe(1);
    expect(nearestThumbnailIndex([0, 4, 10], 8)).toBe(2);
    expect(nearestThumbnailIndex([], 3)).toBe(-1);
  });

  it('trouve la vignette du plan en cours', () => {
    expect(activeThumbnailIndex([0, 4, 10], 9.9)).toBe(1);
    expect(activeThumbnailIndex([0, 4, 10], 10)).toBe(2);
    expect(activeThumbnailIndex([0, 4, 10], -1)).toBe(0);
    expect(activeThumbnailIndex([], 3)).toBe(-1);
  });

  it('positionne une cellule 160×90 du sprite', () => {
    expect(spritePosition(0)).toBe('0px 0px');
    expect(spritePosition(3)).toBe('-480px 0px');
    expect(spritePosition(-2)).toBe('0px 0px');
  });

  it('produit une url CSS échappée', () => {
    expect(cssUrl('')).toBe('none');
    expect(cssUrl('blob:http://x/1')).toBe('url("blob:http://x/1")');
    expect(cssUrl('a"b')).toBe('url("a\\"b")');
  });

  it('centre un arrêt de dégradé par seconde et ignore les couleurs invalides', () => {
    expect(paletteStops(['#000000', 'red', '#ffffff', '#FFAA00'])).toEqual([
      { offset: 12.5, color: '#000000' },
      { offset: 62.5, color: '#ffffff' },
      { offset: 87.5, color: '#FFAA00' },
    ]);
    expect(paletteStops([])).toEqual([]);
  });
});
