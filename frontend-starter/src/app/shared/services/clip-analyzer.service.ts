import { Injectable } from '@angular/core';
import { ClipAnalysis } from '../models/clip.model';
import { detectBeats } from '../analysis/beat-detector';
import { detectCuts, histogramDifference } from '../analysis/cut-detector';
import { syncScore } from '../analysis/sync-score';

/** Durée maximale (s) d'un extrait analysable. */
export const MAX_CLIP_DURATION_SEC = 120;
/** Images échantillonnées par seconde de vidéo. */
export const SAMPLE_FPS = 10;

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 36;
/** Part de la progression consacrée à la vidéo ; le reste va à l'audio. */
const VIDEO_PROGRESS_SHARE = 0.85;
const TIME_DECIMALS = 1000;

export type ClipAnalysisErrorCode = 'too-long' | 'unreadable' | 'aborted';

const ERROR_MESSAGES: Record<ClipAnalysisErrorCode, string> = {
  'too-long': `L'extrait dépasse ${MAX_CLIP_DURATION_SEC} secondes.`,
  unreadable: 'Impossible de lire cette vidéo (format ou codec non pris en charge).',
  aborted: 'Analyse annulée.',
};

/** Erreur d'analyse, avec un message français affichable tel quel. */
export class ClipAnalysisError extends Error {
  constructor(readonly code: ClipAnalysisErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ClipAnalysisError';
  }
}

export interface ClipAnalyzeOptions {
  signal?: AbortSignal;
  /** Progression dans [0, 1], croissante. */
  onProgress?: (ratio: number) => void;
}

/** Vidéo ouverte : durée et lecture d'une image réduite (RGBA) à un instant donné. */
export interface FrameSource {
  durationSec: number;
  frameAt(timeSec: number): Promise<Uint8ClampedArray>;
  close(): void;
}

/** Piste audio décodée, un tableau d'échantillons par canal. */
export interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
}

/** Moyenne des canaux, échantillon par échantillon (longueur du canal le plus court). */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

function roundTime(value: number): number {
  return Math.round(value * TIME_DECIMALS) / TIME_DECIMALS;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ClipAnalysisError('aborted');
}

/** Résout au premier `event` de la cible, rejette sur `error`. */
function once(target: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      target.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      target.removeEventListener(event, onEvent);
      reject(new ClipAnalysisError('unreadable'));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

/**
 * Analyse un extrait vidéo dans le navigateur : coupes (histogrammes d'images
 * échantillonnées), beats de la bande-son et score de synchronisation.
 */
@Injectable({ providedIn: 'root' })
export class ClipAnalyzerService {
  async analyze(file: File, options: ClipAnalyzeOptions = {}): Promise<ClipAnalysis> {
    const { signal, onProgress } = options;
    throwIfAborted(signal);
    onProgress?.(0);
    const url = URL.createObjectURL(file);
    try {
      const { durationSec, diffs } = await this.analyzeVideo(url, options);
      const beats = await this.analyzeAudio(file, signal);
      onProgress?.(1);
      const cuts = detectCuts(diffs, SAMPLE_FPS).map(roundTime);
      const duration = roundTime(durationSec);
      return { version: 1, durationSec: duration, cuts, beats, syncScore: syncScore(cuts, beats, duration) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Différences d'histogramme entre images successives, échantillonnées à SAMPLE_FPS. */
  private async analyzeVideo(
    url: string,
    { signal, onProgress }: ClipAnalyzeOptions,
  ): Promise<{ durationSec: number; diffs: number[] }> {
    const source = await this.openVideo(url).catch((error: unknown) => {
      throw error instanceof ClipAnalysisError ? error : new ClipAnalysisError('unreadable');
    });
    try {
      const durationSec = source.durationSec;
      if (!Number.isFinite(durationSec) || durationSec <= 0) throw new ClipAnalysisError('unreadable');
      if (durationSec > MAX_CLIP_DURATION_SEC) throw new ClipAnalysisError('too-long');

      const frameCount = Math.max(1, Math.ceil(durationSec * SAMPLE_FPS));
      const diffs: number[] = [];
      let previous: Uint8ClampedArray | null = null;
      for (let i = 0; i < frameCount; i++) {
        throwIfAborted(signal);
        const frame = await source.frameAt(i / SAMPLE_FPS);
        if (previous) diffs.push(histogramDifference(previous, frame));
        previous = frame;
        onProgress?.((VIDEO_PROGRESS_SHARE * (i + 1)) / frameCount);
      }
      return { durationSec, diffs };
    } finally {
      source.close();
    }
  }

  /** Beats arrondis de la bande-son ; tableau vide si elle ne peut pas être décodée. */
  private async analyzeAudio(file: File, signal?: AbortSignal): Promise<number[]> {
    throwIfAborted(signal);
    let audio: DecodedAudio;
    try {
      audio = await this.decodeAudio(file);
    } catch {
      console.debug('[Analyzer] Piste audio non décodable, analyse des coupes seule');
      return [];
    }
    throwIfAborted(signal);
    return detectBeats(mixToMono(audio.channels), audio.sampleRate).map(roundTime);
  }

  /** Ouvre la vidéo hors DOM et prépare un canvas réduit pour lire ses images. */
  protected async openVideo(url: string): Promise<FrameSource> {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    const metadata = once(video, 'loadedmetadata');
    video.src = url;
    await metadata;

    const canvas = document.createElement('canvas');
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new ClipAnalysisError('unreadable');

    return {
      durationSec: video.duration,
      frameAt: async (timeSec) => {
        const seeked = once(video, 'seeked');
        video.currentTime = timeSec;
        await seeked;
        context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        return context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;
      },
      close: () => {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  /** Décode la piste audio du fichier ; rejette si codec ou piste absents. */
  protected async decodeAudio(file: File): Promise<DecodedAudio> {
    const buffer = await file.arrayBuffer();
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(buffer);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
      return { channels, sampleRate: decoded.sampleRate };
    } finally {
      context.close().catch(() => undefined);
    }
  }
}
