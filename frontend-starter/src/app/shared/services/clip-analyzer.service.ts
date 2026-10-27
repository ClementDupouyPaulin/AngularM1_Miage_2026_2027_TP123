import { Injectable } from '@angular/core';
import { ClipAnalysis } from '../models/clip.model';
import { detectBeats } from '../analysis/beat-detector';
import { DEFAULT_K, detectCuts, frameDifference } from '../analysis/cut-detector';
import { dominantColor, paletteFromColors } from '../analysis/palette';
import { rebuildAnalysis } from '../analysis/redetect';
import { syncScore } from '../analysis/sync-score';
import { detectTransitions } from '../analysis/transitions';
import { BeatWorkerRequest, BeatWorkerResponse } from './analysis-worker.messages';

/** Durée maximale (s) d'un extrait analysable. */
export const MAX_CLIP_DURATION_SEC = 120;
/** Images échantillonnées par seconde de vidéo. */
export const SAMPLE_FPS = 10;

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 36;
/** Progression atteinte à la fin de l'échantillonnage vidéo, puis de la pellicule ; le reste va à l'audio. */
const VIDEO_PROGRESS_END = 0.8;
const FILMSTRIP_PROGRESS_END = 0.9;
/** Taille d'une cellule de la pellicule. */
export const THUMBNAIL_WIDTH = 160;
export const THUMBNAIL_HEIGHT = 90;
/** Cellules maximales de la pellicule : l'image 0 puis une par coupe. */
export const MAX_THUMBNAILS = 41;
/** Décalage (s) après une coupe pour capturer le nouveau plan plutôt que la transition. */
const THUMBNAIL_OFFSET_SEC = 0.1;
/** Taille maximale (octets) de la pellicule JPEG. */
export const MAX_FILMSTRIP_BYTES = 1024 * 1024;
/** Qualités JPEG essayées dans l'ordre avant de réduire le nombre de cellules. */
const JPEG_QUALITIES = [0.8, 0.6, 0.4];
/** Délai maximal (ms) de la détection des beats dans le worker avant repli sur le thread principal. */
export const WORKER_TIMEOUT_MS = 30000;
/** Délai maximal (ms) du décodage de la piste audio avant repli sur l'analyse des coupes seule. */
export const AUDIO_DECODE_TIMEOUT_MS = 30000;
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

/** Image échantillonnée, pour l'aperçu en direct (`diff` = 0 pour la première). */
export interface ClipAnalysisSample {
  time: number;
  diff: number;
  color: string;
}

export interface ClipAnalyzeOptions {
  signal?: AbortSignal;
  /** Progression dans [0, 1], croissante. */
  onProgress?: (ratio: number) => void;
  /** Appelé à chaque image échantillonnée. */
  onSample?: (sample: ClipAnalysisSample) => void;
}

/** Analyse v2 et pellicule JPEG (`null` si sa capture a échoué). */
export interface ClipAnalysisResult {
  analysis: ClipAnalysis;
  filmstrip: Blob | null;
}

/** Vidéo ouverte : durée, lecture d'une image réduite (RGBA) et dessin d'une image dans un canvas. */
export interface FrameSource {
  durationSec: number;
  frameAt(timeSec: number): Promise<Uint8ClampedArray>;
  /** Dessine l'image à `timeSec` dans `context`, en (x, 0), à la taille width × height. */
  drawFrame(timeSec: number, context: CanvasRenderingContext2D, x: number, width: number, height: number): Promise<void>;
  close(): void;
}

/** Cellule de pellicule : instant capturé et force de la coupe (Infinity pour l'image 0). */
export interface ThumbnailCell {
  time: number;
  strength: number;
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

/** Cellules de la pellicule : l'image 0 puis chaque coupe + 0,1 s ; les coupes les plus fortes si elles sont trop nombreuses. */
export function thumbnailCells(cuts: number[], diffs: number[], fps: number, durationSec: number): ThumbnailCell[] {
  const cutCells = cuts.map((cut) => ({
    time: roundTime(Math.min(cut + THUMBNAIL_OFFSET_SEC, durationSec)),
    strength: diffs[Math.round(cut * fps) - 1] ?? 0,
  }));
  return [{ time: 0, strength: Number.POSITIVE_INFINITY }, ...strongest(cutCells, MAX_THUMBNAILS - 1)];
}

/** Les `count` cellules les plus fortes, remises dans l'ordre chronologique. */
function strongest(cells: ThumbnailCell[], count: number): ThumbnailCell[] {
  if (cells.length <= count) return cells;
  return [...cells]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, count)
    .sort((a, b) => a.time - b.time);
}

function roundTime(value: number): number {
  return Math.round(value * TIME_DECIMALS) / TIME_DECIMALS;
}

/** Envoie les échantillons (transférés) au worker et résout avec ses beats. */
function runBeatWorker(worker: Worker, samples: Float32Array, sampleRate: number): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<BeatWorkerResponse>) => {
      if ('beats' in data) resolve(data.beats);
      else reject(new Error(data.error));
    };
    worker.onerror = () => reject(new Error('Erreur du worker d’analyse'));
    worker.onmessageerror = () => reject(new Error('Message du worker illisible'));
    const request: BeatWorkerRequest = { samples, sampleRate };
    worker.postMessage(request, [samples.buffer]);
  });
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
 * Analyse un extrait vidéo dans le navigateur : coupes et fondus (différences
 * entre images échantillonnées), palette, pellicule, beats de la bande-son et
 * score de synchronisation.
 */
@Injectable({ providedIn: 'root' })
export class ClipAnalyzerService {
  async analyze(file: File, options: ClipAnalyzeOptions = {}): Promise<ClipAnalysisResult> {
    const { signal, onProgress } = options;
    throwIfAborted(signal);
    onProgress?.(0);
    const url = URL.createObjectURL(file);
    try {
      const video = await this.analyzeVideo(url, options);
      const beats = (await this.analyzeAudio(file, signal)).filter((time) => time >= 0 && time <= video.durationSec);
      onProgress?.(1);
      const analysis: ClipAnalysis = {
        version: 2,
        durationSec: video.durationSec,
        fps: SAMPLE_FPS,
        cuts: video.cuts,
        beats,
        syncScore: syncScore(video.cuts, beats, video.durationSec),
        diffs: video.diffs,
        palette: video.palette,
        transitions: video.transitions,
        thumbnailTimes: video.thumbnailTimes,
        sensitivity: DEFAULT_K,
      };
      return { analysis, filmstrip: video.filmstrip };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Analyse recalculée avec le coefficient `k` (curseur de sensibilité), sans relire la vidéo. */
  rebuild(analysis: ClipAnalysis, k: number): ClipAnalysis {
    return rebuildAnalysis(analysis, k);
  }

  /** Échantillonnage, détection des coupes et fondus, puis pellicule, la vidéo restant ouverte. */
  private async analyzeVideo(url: string, options: ClipAnalyzeOptions) {
    const { signal } = options;
    const source = await this.openVideo(url, signal).catch((error: unknown) => {
      throw error instanceof ClipAnalysisError ? error : new ClipAnalysisError('unreadable');
    });
    try {
      if (source.durationSec === Number.POSITIVE_INFINITY) throw new ClipAnalysisError('unknown-duration');
      if (!Number.isFinite(source.durationSec) || source.durationSec <= 0) throw new ClipAnalysisError('unreadable');
      if (source.durationSec > MAX_CLIP_DURATION_SEC) throw new ClipAnalysisError('too-long');

      const durationSec = roundTime(source.durationSec);
      const withinClip = (time: number) => time >= 0 && time <= durationSec;
      const { diffs, colors } = await this.sampleFrames(source, options);
      const cuts = detectCuts(diffs, SAMPLE_FPS).map(roundTime).filter(withinClip);
      const transitions = detectTransitions(diffs, SAMPLE_FPS, cuts).filter((t) => withinClip(t.time));
      const cells = thumbnailCells(cuts, diffs, SAMPLE_FPS, durationSec);
      const strip = await this.captureFilmstrip(source, cells, options);
      return {
        durationSec,
        diffs,
        palette: paletteFromColors(colors, SAMPLE_FPS),
        cuts,
        transitions,
        thumbnailTimes: strip ? strip.cells.map((cell) => cell.time) : [],
        filmstrip: strip?.blob ?? null,
      };
    } finally {
      source.close();
    }
  }

  /** Différences entre images successives (3 décimales, voir `frameDifference`) et couleur dominante de chaque image, échantillonnées à SAMPLE_FPS. */
  private async sampleFrames(
    source: FrameSource,
    { signal, onProgress, onSample }: ClipAnalyzeOptions,
  ): Promise<{ diffs: number[]; colors: string[] }> {
    const frameCount = Math.max(1, Math.ceil(source.durationSec * SAMPLE_FPS));
    const diffs: number[] = [];
    const colors: string[] = [];
    let previous: Uint8ClampedArray | null = null;
    for (let i = 0; i < frameCount; i++) {
      throwIfAborted(signal);
      const time = i / SAMPLE_FPS;
      const frame = await withDeadline(source.frameAt(time), SEEK_TIMEOUT_MS, signal);
      const diff = previous ? roundTime(frameDifference(previous, frame, FRAME_WIDTH)) : 0;
      if (previous) diffs.push(diff);
      const color = dominantColor(frame);
      colors.push(color);
      previous = frame;
      onSample?.({ time: roundTime(time), diff, color });
      onProgress?.((VIDEO_PROGRESS_END * (i + 1)) / frameCount);
    }
    return { diffs, colors };
  }

  /**
   * Pellicule : capture chaque cellule à THUMBNAIL_WIDTH × THUMBNAIL_HEIGHT dans un
   * sprite horizontal, encodé en JPEG ≤ MAX_FILMSTRIP_BYTES (qualité puis nombre de
   * cellules réduits si besoin). `null` si la capture échoue ; seule l'annulation est propagée.
   */
  private async captureFilmstrip(
    source: FrameSource,
    cells: ThumbnailCell[],
    { signal, onProgress }: ClipAnalyzeOptions,
  ): Promise<{ blob: Blob; cells: ThumbnailCell[] } | null> {
    try {
      const sprite = this.createCanvas(cells.length * THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
      const context = sprite.getContext('2d');
      if (!context) throw new Error('Canvas 2D indisponible');
      for (const [i, cell] of cells.entries()) {
        throwIfAborted(signal);
        await withDeadline(
          source.drawFrame(cell.time, context, i * THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT),
          SEEK_TIMEOUT_MS,
          signal,
        );
        onProgress?.(VIDEO_PROGRESS_END + ((FILMSTRIP_PROGRESS_END - VIDEO_PROGRESS_END) * (i + 1)) / cells.length);
      }
      return await this.encodeFilmstrip(sprite, cells);
    } catch (error) {
      if (error instanceof ClipAnalysisError && error.code === 'aborted') throw error;
      console.debug('[Analyzer] Pellicule non capturée, analyse conservée sans vignettes');
      return null;
    }
  }

  /** Encode le sprite sous MAX_FILMSTRIP_BYTES, en divisant par deux les cellules (les plus fortes gardées) si nécessaire. */
  private async encodeFilmstrip(
    sprite: HTMLCanvasElement,
    cells: ThumbnailCell[],
  ): Promise<{ blob: Blob; cells: ThumbnailCell[] } | null> {
    let kept = cells;
    for (;;) {
      const canvas = kept === cells ? sprite : this.extractCells(sprite, cells, kept);
      for (const quality of JPEG_QUALITIES) {
        const blob = await this.encodeJpeg(canvas, quality);
        if (!blob) return null;
        if (blob.size <= MAX_FILMSTRIP_BYTES) return { blob, cells: kept };
      }
      if (kept.length === 1) return null;
      kept = [kept[0], ...strongest(kept.slice(1), Math.ceil(kept.length / 2) - 1)];
    }
  }

  /** Nouveau sprite ne contenant que les cellules `kept` de `sprite`. */
  private extractCells(sprite: HTMLCanvasElement, cells: ThumbnailCell[], kept: ThumbnailCell[]): HTMLCanvasElement {
    const canvas = this.createCanvas(kept.length * THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D indisponible');
    kept.forEach((cell, i) => {
      const sx = cells.indexOf(cell) * THUMBNAIL_WIDTH;
      context.drawImage(sprite, sx, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, i * THUMBNAIL_WIDTH, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    });
    return canvas;
  }

  /** Beats arrondis de la bande-son ; tableau vide si elle ne peut pas être décodée. */
  private async analyzeAudio(file: File, signal?: AbortSignal): Promise<number[]> {
    throwIfAborted(signal);
    let audio: DecodedAudio;
    try {
      audio = await withDeadline(this.decodeAudio(file), AUDIO_DECODE_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof ClipAnalysisError && error.code === 'aborted') throw error;
      console.debug('[Analyzer] Piste audio non décodable, analyse des coupes seule');
      return [];
    }
    throwIfAborted(signal);
    return (await this.detectBeatsOffThread(audio, signal)).map(roundTime);
  }

  /**
   * Détection des beats dans un Web Worker (échantillons transférés), avec repli
   * sur le thread principal si le worker est indisponible, échoue ou dépasse le délai.
   */
  private async detectBeatsOffThread(audio: DecodedAudio, signal?: AbortSignal): Promise<number[]> {
    let worker: Worker | null = null;
    try {
      worker = this.createBeatWorker();
    } catch {
      worker = null;
    }
    if (!worker) return detectBeats(mixToMono(audio.channels), audio.sampleRate);
    try {
      return await withDeadline(runBeatWorker(worker, mixToMono(audio.channels), audio.sampleRate), WORKER_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof ClipAnalysisError && error.code === 'aborted') throw error;
      console.debug('[Analyzer] Worker d’analyse en échec, détection des beats sur le thread principal');
      return detectBeats(mixToMono(audio.channels), audio.sampleRate);
    } finally {
      worker.terminate();
    }
  }

  /** Worker de détection des beats ; `null` si l'environnement n'en fournit pas. */
  protected createBeatWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('./analysis.worker', import.meta.url), { type: 'module' });
  }

  /** Canvas hors DOM (sprite de la pellicule). */
  protected createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /** Encode le canvas en JPEG ; `null` si le navigateur échoue. */
  protected encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
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

    const seek = async (timeSec: number) => {
      const seeked = once(video, ['seeked'], SEEK_TIMEOUT_MS, signal);
      video.currentTime = timeSec;
      await seeked;
    };

    return {
      durationSec,
      frameAt: async (timeSec) => {
        await seek(timeSec);
        context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        return context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT).data;
      },
      drawFrame: async (timeSec, target, x, width, height) => {
        await seek(timeSec);
        target.drawImage(video, x, 0, width, height);
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
