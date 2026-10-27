/**
 * Vérité terrain des coupes des échantillons, établie à la main sur planches contact
 * (captures toutes les 0,1 s, puis 1/24 s autour des points ambigus) dans Chrome.
 * Temps en secondes : première image du nouveau plan.
 *
 * - `cuts` : coupes franches à retrouver. Plusieurs coupes à moins de 0,3 s
 *   d'intervalle comptent pour une seule (limite de l'échantillonnage à 10 img/s).
 * - `optional` : changements réels mais ambigus ou hors de portée d'une image
 *   réduite à 64 × 36 (cartons de texte sur fond noir, mouvements très rapides) :
 *   ni exigés, ni comptés comme fausses coupes.
 * Les fondus et fondus enchaînés ne sont pas des coupes.
 */
export interface GroundTruth {
  cuts: number[];
  optional: number[];
}

export const MATCH_TOLERANCE_SEC = 0.3;

const SINTEL_TRAILER: GroundTruth = {
  // 13,9 vieil homme → Sintel ; 16,5 noir → neige ; 16,86-17,03 trois plans de combat ;
  // 17,5 → noir ; 23,8 Sintel → ville ; 25,9 ville → ciel ; 27,4 dragon → visage ; 28,0 → noir.
  cuts: [13.9, 16.5, 16.9, 17.5, 23.8, 25.9, 27.4, 28.0],
  // 9,4 / 47,5 / 48,5 / 50,9 cartons de texte ; 17,0 fin de la rafale de 16,9 ; 26,5 et 26,9 vol du dragon.
  optional: [9.4, 17.0, 26.5, 26.9, 47.5, 48.5, 50.9],
};

const SINTEL_10S: GroundTruth = {
  cuts: [2.43, 3.18, 4.01, 4.93, 5.84, 7.34, 8.13, 8.72],
  optional: [],
};

/** Plans uniques : jellyfish (caméra lente, particules), bbb (plan fixe). */
const SINGLE_SHOT: GroundTruth = { cuts: [], optional: [] };

export const GROUND_TRUTH: Record<string, GroundTruth> = {
  'sintel_trailer-480p.mp4': SINTEL_TRAILER,
  'sintel_10s_360.mp4': SINTEL_10S,
  'sintel_10s_720.mp4': SINTEL_10S,
  'bbb_10s_360.mp4': SINGLE_SHOT,
  'bbb_10s_360.webm': SINGLE_SHOT,
  'bbb_10s_720.mp4': SINGLE_SHOT,
  'jellyfish_10s_360.mp4': SINGLE_SHOT,
  'jellyfish_10s_360.webm': SINGLE_SHOT,
};

export interface MatchScore {
  truePositives: number;
  falseCuts: number[];
  missed: number[];
  recall: number;
  precision: number;
}

/**
 * Appariement un-pour-un des coupes détectées avec la vérité terrain (±MATCH_TOLERANCE_SEC).
 * Une détection proche d'un changement `optional` n'est ni bonne ni fausse.
 */
export function matchCuts(detected: number[], truth: GroundTruth): MatchScore {
  const used = new Set<number>();
  const falseCuts: number[] = [];
  for (const time of detected) {
    const match = truth.cuts.findIndex((cut, i) => !used.has(i) && Math.abs(cut - time) <= MATCH_TOLERANCE_SEC);
    if (match >= 0) used.add(match);
    else if (!truth.optional.some((cut) => Math.abs(cut - time) <= MATCH_TOLERANCE_SEC)) falseCuts.push(time);
  }
  const truePositives = used.size;
  return {
    truePositives,
    falseCuts,
    missed: truth.cuts.filter((_, i) => !used.has(i)),
    recall: truth.cuts.length ? truePositives / truth.cuts.length : 1,
    precision: truePositives + falseCuts.length ? truePositives / (truePositives + falseCuts.length) : 1,
  };
}
