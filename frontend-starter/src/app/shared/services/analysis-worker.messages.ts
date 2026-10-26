/** Demande au worker d'analyse : échantillons mono transférés et leur fréquence. */
export interface BeatWorkerRequest {
  samples: Float32Array;
  sampleRate: number;
}

/** Réponse du worker : temps des beats (s), ou message d'erreur. */
export type BeatWorkerResponse = { beats: number[] } | { error: string };
