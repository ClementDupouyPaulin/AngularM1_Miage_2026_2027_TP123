import { ClipAnnotation } from '../../shared/models/clip.model';
import {
  annotationTime,
  interpretSyncScore,
  nextCut,
  parseTags,
  previousCut,
  sortAnnotations,
  tagsError,
  tempoComparison,
} from './montage';

function note(id: string, time: number, createdAt = '2026-10-01T10:00:00.000Z'): ClipAnnotation {
  return { id, time, text: id, authorId: 'u1', authorName: 'Moi', createdAt };
}

describe('montage : fonctions pures', () => {
  it('interprète le score de synchro', () => {
    expect(interpretSyncScore(null).verdict).toBe('Bande-son non analysable');
    expect(interpretSyncScore(1.02).verdict).toBe('Sans lien avec la musique');
    expect(interpretSyncScore(2.5)).toEqual({ value: '× 2,50', verdict: 'Calé sur la musique' });
  });

  it('trouve la coupe précédente (avec marge) et suivante', () => {
    const cuts = [5, 10, 20];
    expect(previousCut(cuts, 10.2)).toBe(5);
    expect(previousCut(cuts, 12)).toBe(10);
    expect(previousCut(cuts, 3)).toBeNull();
    expect(nextCut(cuts, 10)).toBe(20);
    expect(nextCut(cuts, 0)).toBe(5);
    expect(nextCut(cuts, 25)).toBeNull();
  });

  it('compare le tempo de la musique aux coupes par minute', () => {
    expect(tempoComparison(null, 12)).toContain('non mesurable');
    expect(tempoComparison(120, 0)).toBe('Aucune coupe à comparer');
    expect(tempoComparison(120, 30)).toBe('≈ 1 coupe tous les 4,0 temps (30,0 coupes/min)');
  });

  it('trie les annotations par instant puis par date', () => {
    const sorted = sortAnnotations([note('b', 12), note('c', 3, '2026-10-02'), note('a', 3, '2026-10-01')]);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('normalise et valide les étiquettes', () => {
    expect(parseTags(' Action, nuit ,, action ')).toEqual(['action', 'nuit']);
    expect(tagsError(['a', 'b', 'c', 'd', 'e'])).toBeNull();
    expect(tagsError(['a', 'b', 'c', 'd', 'e', 'f'])).toContain('5 étiquettes');
    expect(tagsError(['x'.repeat(25)])).toContain('24 caractères');
  });

  it('borne et arrondit l’instant d’une annotation', () => {
    expect(annotationTime(12.38, 30)).toBe(12.3);
    expect(annotationTime(-2, 30)).toBe(0);
    expect(annotationTime(45, 30)).toBe(30);
    expect(annotationTime(Number.NaN, 30)).toBe(0);
  });
});
