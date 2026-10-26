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
/** Délai maximal (ms) d'un déplacement dans la vidéo avant de la déclarer illisible. */
export const SEEK_TIMEOUT_MS = 5000;
/** Délai maximal (ms) de chargement des métadonnées. */
export const METADATA_TIMEOUT_MS = 10000;
/** Position hors fin qui force le calcul de la durée d'une WebM annonçant `Infinity`. */
const DURATION_PROBE_TIME = 1e101;

export type ClipAnalysisErrorCode = 'too-long' | 'unreadable' | 'unknown-duration' | 'aborted';

const ERROR_MESSAGES: Record<ClipAnalysisErrorCode, string> = {
  'too-long': `L'extrait dépasse ${MAX_CLIP_DURATION_SEC} secondes.`,
  unreadable: 'Impossible de lire cette vidéo (format ou codec non pris en charge).',
  'unknown-duration': 'Impossible d’analyser cette vidéo : durée de la vidéo indéterminée.',
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

/**
 * Relaie `promise`, mais rejette en 'unreadable' après `timeoutMs`
 * et en 'aborted' dès l'annulation de `signal`.
 */
export function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ClipAnalysisError('aborted'));
      return;
    }
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const onAbort = () => settle(() => reject(new ClipAnalysisError('aborted')));
    const timer = setTimeout(() => settle(() => reject(new ClipAnalysisError('unreadable'))), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

/** Résout au premier des `events` de la cible, rejette sur `error`, délai ou annulation. */
function once(target: EventTarget, events: string[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  let cleanup: () => void = () => undefined;
  const fired = new Promise<void>((resolve, reject) => {
    const onEvent = () => resolve();
    const onError = () => reject(new ClipAnalysisError('unreadable'));
    events.forEach((event) => target.addEventListener(event, onEvent));
    target.addEventListener('error', onError);
    cleanup = () => {
      events.forEach((event) => target.removeEventListener(event, onEvent));
      target.removeEventListener('error', onError);
    };
  });
  return withDeadline(fired, timeoutMs, signal).finally(cleanup);
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
      const duration = roundTime(durationSec);
      const withinClip = (time: number) => time >= 0 && time <= duration;
      const beats = (await this.analyzeAudio(file, signal)).filter(withinClip);
      onProgress?.(1);
      const cuts = detectCuts(diffs, SAMPLE_FPS).map(roundTime).filter(withinClip);
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
    const source = await this.openVideo(url, signal).catch((error: unknown) => {
      throw error instanceof ClipAnalysisError ? error : new ClipAnalysisError('unreadable');
    });
    try {
      const durationSec = source.durationSec;
      if (durationSec === Number.POSITIVE_INFINITY) throw new ClipAnalysisError('unknown-duration');
      if (!Number.isFinite(durationSec) || durationSec <= 0) throw new ClipAnalysisError('unreadable');
      if (durationSec > MAX_CLIP_DURATION_SEC) throw new ClipAnalysisError('too-long');

      const frameCount = Math.max(1, Math.ceil(durationSec * SAMPLE_FPS));
      const diffs: number[] = [];
      let previous: Uint8ClampedArray | null = null;
      for (let i = 0; i < frameCount; i++) {
        throwIfAborted(signal);
        const frame = await withDeadline(source.frameAt(i / SAMPLE_FPS), SEEK_TIMEOUT_MS, signal);
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
  protected async openVideo(url: string, signal?: AbortSignal): Promise<FrameSource> {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    const metadata = once(video, ['loadedmetadata'], METADATA_TIMEOUT_MS, signal);
    video.src = url;
    await metadata;
    const durationSec = await this.resolveDuration(video, signal);

    const canvas = document.createElement('canvas');
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new ClipAnalysisError('unreadable');

    return {
      durationSec,
      frameAt: async (timeSec) => {
        const seeked = once(video, ['seeked'], SEEK_TIMEOUT_MS, signal);
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

  /**
   * Durée de la vidéo. Certaines WebM annoncent `Infinity` tant qu'on n'a pas
   * cherché au-delà de la fin : on force ce calcul puis on revient au début.
   * Reste `Infinity` si le navigateur ne parvient pas à la déterminer.
   */
  protected async resolveDuration(video: HTMLMediaElement, signal?: AbortSignal): Promise<number> {
    if (video.duration !== Number.POSITIVE_INFINITY) return video.duration;
    try {
      const probed = once(video, ['timeupdate', 'seeked'], SEEK_TIMEOUT_MS, signal);
      video.currentTime = DURATION_PROBE_TIME;
      await probed;
      const durationSec = video.duration;
      const rewound = once(video, ['seeked'], SEEK_TIMEOUT_MS, signal);
      video.currentTime = 0;
      await rewound;
      return durationSec;
    } catch (error) {
      if (error instanceof ClipAnalysisError && error.code === 'aborted') throw error;
      return Number.POSITIVE_INFINITY;
    }
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
