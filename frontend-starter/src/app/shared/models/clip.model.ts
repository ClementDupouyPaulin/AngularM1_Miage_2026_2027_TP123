export interface ClipAnalysis {
  version: 1;
  durationSec: number;
  cuts: number[];
  beats: number[];
  syncScore: number | null;
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
}

export interface Clip extends ClipSummary {
  analysis: ClipAnalysis;
}
