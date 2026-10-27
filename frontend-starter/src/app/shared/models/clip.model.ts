export type ClipVisibility = 'private' | 'shared' | 'public';
export type TransitionKind = 'cut' | 'fade';

export interface ClipTransition {
  time: number;
  kind: TransitionKind;
}

/** Résultat de l'analyse navigateur (v2). Tous les temps sont en secondes. */
export interface ClipAnalysis {
  version: 2;
  durationSec: number;
  /** Images échantillonnées par seconde (10). */
  fps: number;
  cuts: number[];
  beats: number[];
  syncScore: number | null;
  /** `diffs[i]` : différence de luminance (blocs 16×12) entre l'image i et i+1 (0-1, 3 décimales). */
  diffs: number[];
  /** Couleur dominante `#rrggbb` de chaque seconde. */
  palette: string[];
  /** Chaque coupe et chaque fondu détecté, triés par temps. */
  transitions: ClipTransition[];
  /** Instants des vignettes de la pellicule (image 0 puis une par coupe, 41 max). */
  thumbnailTimes: number[];
  /** Coefficient `k` du seuil adaptatif utilisé pour détecter les coupes. */
  sensitivity: number;
}

export interface ClipOwner {
  id: string;
  name: string;
}

export interface ClipSummary {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  durationSec: number;
  cutCount: number;
  avgShotLength: number;
  syncScore: number | null;
  createdAt: string;
  tags: string[];
  visibility: ClipVisibility;
  owner: ClipOwner;
  isOwner: boolean;
  hasFilmstrip: boolean;
  /** Coupes par tranche de durée égale (24 valeurs) : mini-courbe des cartes. */
  sparkline: number[];
}

export interface ClipAnnotation {
  id: string;
  time: number;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface Clip extends ClipSummary {
  analysis: ClipAnalysis;
  annotations: ClipAnnotation[];
  /** Renseigné seulement pour le propriétaire. */
  sharedWith: ClipOwner[];
}

/** Réglages modifiables par le propriétaire (`PATCH /api/clips/:id`). */
export interface ClipPatch {
  title?: string;
  tags?: string[];
  visibility?: ClipVisibility;
  sharedWith?: string[];
}

export interface LibraryStats {
  clipCount: number;
  totalDurationSec: number;
  totalCuts: number;
  avgShotLength: number | null;
  mostNervous: ClipSummary | null;
  mostSynced: ClipSummary | null;
  byVisibility: Record<ClipVisibility, number>;
}

export interface TagCount {
  tag: string;
  count: number;
}

export type DiscoverScope = 'public' | 'friends' | 'shared';
export type DiscoverSort = 'recent' | 'nervous' | 'synced';
