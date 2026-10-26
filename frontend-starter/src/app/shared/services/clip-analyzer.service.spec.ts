import {
  ClipAnalysisError,
  ClipAnalyzerService,
  DecodedAudio,
  FrameSource,
  MAX_CLIP_DURATION_SEC,
  MAX_FILMSTRIP_BYTES,
  MAX_THUMBNAILS,
  SAMPLE_FPS,
  SEEK_TIMEOUT_MS,
  mixToMono,
} from './clip-analyzer.service';

const PIXELS = 16;
const SAMPLE_RATE = 8000;
const OBJECT_URL = 'blob:clip-test';

/** Image RGBA unie de gris `level`. */
function solidFrame(level: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(PIXELS * 4);
  for (let p = 0; p < PIXELS; p++) data.set([level, level, level, 255], p * 4);
  return data;
}

/** Signal muet sauf une salve sinusoïdale de 20 ms à chaque instant de `onsets`. */
function burstSignal(durationSec: number, onsets: number[]): Float32Array {
  const samples = new Float32Array(Math.round(durationSec * SAMPLE_RATE));
  const burst = Math.round(0.02 * SAMPLE_RATE);
  for (const onset of onsets) {
    const start = Math.round(onset * SAMPLE_RATE);
    for (let i = start; i < Math.min(samples.length, start + burst); i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
  }
  return samples;
}

/** Canvas minimal : `drawImage` ignoré, `toBlob` délégué à `encode`. */
function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return { width, height, getContext: () => ({ drawImage: () => undefined }) } as unknown as HTMLCanvasElement;
}

/** Worker simulé : répond `response` (ou déclenche une erreur) au premier message. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  transfer: Transferable[] = [];
  terminated = false;

  constructor(private readonly response: { beats: number[] } | 'error' | 'hang') {}

  postMessage(_message: unknown, transfer: Transferable[]): void {
    this.transfer = transfer;
    queueMicrotask(() => {
      if (this.response === 'hang') return;
      if (this.response === 'error') this.onerror?.(new Event('error'));
      else this.onmessage?.({ data: this.response } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Analyseur dont les accès DOM sont remplacés par des données fabriquées. */
class FakeAnalyzer extends ClipAnalyzerService {
  durationSec = 3;
  /** Instant (s) où l'image passe du noir au blanc. */
  cutAtSec = 1.2;
  /** Niveau de gris de l'image à un instant (par défaut : noir puis blanc à `cutAtSec`). */
  levelAt: (timeSec: number) => number = (timeSec) => (timeSec < this.cutAtSec - 1e-9 ? 0 : 255);
  drawnTimes: number[] = [];
  drawError: Error | null = null;
  /** Taille (octets) du JPEG produit pour un canvas et une qualité. */
  jpegSize: (canvas: HTMLCanvasElement, quality: number) => number = () => 20000;
  jpegQualities: number[] = [];
  worker: FakeWorker | null = null;
  audio: DecodedAudio | Error = { channels: [new Float32Array(SAMPLE_RATE)], sampleRate: SAMPLE_RATE };
  openError: unknown = null;
  seekedTimes: number[] = [];
  closed = false;
  beforeFrame: (timeSec: number) => void = () => undefined;
  /** Si vrai, `frameAt` ne se résout jamais (seek bloqué). */
  frameHangs = false;

  probeDuration(video: EventTarget, signal?: AbortSignal): Promise<number> {
    return this.resolveDuration(video as HTMLMediaElement, signal);
  }

  protected override async openVideo(): Promise<FrameSource> {
    if (this.openError) throw this.openError;
    return {
      durationSec: this.durationSec,
      frameAt: async (timeSec) => {
        this.beforeFrame(timeSec);
        this.seekedTimes.push(timeSec);
        if (this.frameHangs) return new Promise<Uint8ClampedArray>(() => undefined);
        return solidFrame(this.levelAt(timeSec));
      },
      drawFrame: async (timeSec) => {
        if (this.drawError) throw this.drawError;
        this.drawnTimes.push(timeSec);
      },
      close: () => {
        this.closed = true;
      },
    };
  }

  protected override async decodeAudio(): Promise<DecodedAudio> {
    if (this.audio instanceof Error) throw this.audio;
    return this.audio;
  }

  protected override createCanvas(width: number, height: number): HTMLCanvasElement {
    return fakeCanvas(width, height);
  }

  protected override async encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
    this.jpegQualities.push(quality);
    return new Blob([new Uint8Array(this.jpegSize(canvas, quality))], { type: 'image/jpeg' });
  }

  protected override createBeatWorker(): Worker | null {
    return this.worker ? (this.worker as unknown as Worker) : super.createBeatWorker();
  }
}

/** Élément média minimal : la durée devient `computedDuration` après un seek au-delà de la fin. */
class FakeVideo extends EventTarget {
  duration = Number.POSITIVE_INFINITY;
  private time = 0;

  constructor(private readonly computedDuration: number) {
    super();
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    const beyondEnd = value > 1e100;
    this.time = beyondEnd ? this.computedDuration : value;
    if (beyondEnd) this.duration = this.computedDuration;
    queueMicrotask(() => this.dispatchEvent(new Event(beyondEnd ? 'timeupdate' : 'seeked')));
  }
}

describe('mixToMono', () => {
  it('moyenne les canaux échantillon par échantillon', () => {
    const mono = mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0.5, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.25, 0]);
  });

  it('renvoie une copie d’un canal unique', () => {
    const channel = new Float32Array([0.25, -0.5]);
    const mono = mixToMono([channel]);
    expect(Array.from(mono)).toEqual([0.25, -0.5]);
    expect(mono).not.toBe(channel);
  });

  it('se limite au canal le plus court et gère l’absence de canal', () => {
    expect(mixToMono([new Float32Array([1, 1, 1]), new Float32Array([1])]).length).toBe(1);
    expect(mixToMono([]).length).toBe(0);
  });
});

describe('ClipAnalyzerService', () => {
  let analyzer: FakeAnalyzer;
  let createSpy: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;
  const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
  const { createObjectURL, revokeObjectURL } = URL;

  beforeEach(() => {
    analyzer = new FakeAnalyzer();
    createSpy = vi.fn<(obj: Blob | MediaSource) => string>(() => OBJECT_URL);
    revokeSpy = vi.fn<(url: string) => void>();
    URL.createObjectURL = createSpy;
    URL.revokeObjectURL = revokeSpy;
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.restoreAllMocks();
  });

  it('échantillonne à SAMPLE_FPS et détecte la coupe', async () => {
    const { analysis: result } = await analyzer.analyze(file);

    expect(analyzer.seekedTimes.length).toBe(analyzer.durationSec * SAMPLE_FPS);
    expect(analyzer.seekedTimes[1]).toBeCloseTo(1 / SAMPLE_FPS, 9);
    expect(result.version).toBe(2);
    expect(result.durationSec).toBe(3);
    expect(result.cuts).toEqual([1.2]);
    expect(analyzer.closed).toBe(true);
    expect(createSpy).toHaveBeenCalledWith(file);
    expect(revokeSpy).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('calcule beats et score de synchro avec des temps arrondis à 3 décimales', async () => {
    analyzer.durationSec = 3.14159;
    analyzer.audio = { channels: [burstSignal(3, [0.5, 1.2, 2]), burstSignal(3, [0.5, 1.2, 2])], sampleRate: SAMPLE_RATE };

    const { analysis: result } = await analyzer.analyze(file);

    expect(result.durationSec).toBe(3.142);
    expect(result.beats.length).toBe(3);
    for (const time of [...result.beats, ...result.cuts, ...result.diffs, ...result.thumbnailTimes]) {
      expect(Math.round(time * 1000) / 1000).toBe(time);
    }
    expect(result.syncScore).toBeGreaterThan(1);
  });

  it('signale une progression croissante de 0 à 1', async () => {
    const ratios: number[] = [];
    await analyzer.analyze(file, { onProgress: (ratio) => ratios.push(ratio) });

    expect(ratios[0]).toBe(0);
    expect(ratios.at(-1)).toBe(1);
    expect(ratios).toContain(0.8);
    expect(ratios).toContain(0.9);
    ratios.slice(1).forEach((ratio, i) => expect(ratio).toBeGreaterThanOrEqual(ratios[i]));
  });

  it('refuse un extrait trop long et révoque l’URL', async () => {
    analyzer.durationSec = MAX_CLIP_DURATION_SEC + 1;

    await expect(analyzer.analyze(file)).rejects.toMatchObject({ code: 'too-long' });
    expect(analyzer.seekedTimes).toEqual([]);
    expect(analyzer.closed).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('signale une vidéo illisible (ouverture en échec ou durée invalide)', async () => {
    analyzer.openError = new Error('MEDIA_ERR_SRC_NOT_SUPPORTED');
    const error = await analyzer.analyze(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClipAnalysisError);
    expect((error as ClipAnalysisError).code).toBe('unreadable');
    expect((error as ClipAnalysisError).message).toContain('Impossible de lire');

    analyzer.openError = null;
    analyzer.durationSec = Number.NaN;
    await expect(analyzer.analyze(file)).rejects.toMatchObject({ code: 'unreadable' });
    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });

  it('refuse avec un message dédié une durée restée infinie', async () => {
    analyzer.durationSec = Number.POSITIVE_INFINITY;

    const error = await analyzer.analyze(file).catch((e: unknown) => e);

    expect((error as ClipAnalysisError).code).toBe('unknown-duration');
    expect((error as ClipAnalysisError).message).toContain('durée de la vidéo indéterminée');
  });

  it('force la durée d’une WebM annonçant Infinity puis revient au début', async () => {
    const video = new FakeVideo(12.5);

    await expect(analyzer.probeDuration(video)).resolves.toBe(12.5);
    expect(video.currentTime).toBe(0);
  });

  it('laisse la durée infinie si le navigateur ne la détermine pas', async () => {
    await expect(analyzer.probeDuration(new FakeVideo(Number.POSITIVE_INFINITY))).resolves.toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('ignore les beats situés après la fin de la vidéo', async () => {
    analyzer.durationSec = 3;
    analyzer.audio = { channels: [burstSignal(3, [0.5, 1.2, 2.6])], sampleRate: SAMPLE_RATE };
    expect((await analyzer.analyze(file)).analysis.beats.length).toBe(3);

    analyzer.durationSec = 2.3;
    const { analysis: result } = await analyzer.analyze(file);

    expect(result.beats.length).toBe(2);
    expect(result.beats.every((beat) => beat >= 0 && beat <= result.durationSec)).toBe(true);
  });

  it('rejette immédiatement sur annulation pendant un seek bloqué', async () => {
    const controller = new AbortController();
    analyzer.frameHangs = true;

    const pending = analyzer.analyze(file, { signal: controller.signal });
    await vi.waitFor(() => expect(analyzer.seekedTimes.length).toBe(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(analyzer.closed).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('déclare la vidéo illisible quand un seek dépasse le délai', async () => {
    vi.useFakeTimers();
    try {
      analyzer.frameHangs = true;
      const assertion = expect(analyzer.analyze(file)).rejects.toMatchObject({ code: 'unreadable' });

      await vi.advanceTimersByTimeAsync(SEEK_TIMEOUT_MS);

      await assertion;
      expect(analyzer.seekedTimes.length).toBe(1);
      expect(analyzer.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('s’interrompt sur abort pendant l’échantillonnage', async () => {
    const controller = new AbortController();
    analyzer.beforeFrame = (timeSec) => {
      if (timeSec >= 0.5) controller.abort();
    };

    await expect(analyzer.analyze(file, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(analyzer.seekedTimes.length).toBe(6);
    expect(analyzer.closed).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('refuse immédiatement un signal déjà annulé', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(analyzer.analyze(file, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('se replie sur les coupes seules si l’audio ne se décode pas', async () => {
    analyzer.audio = new Error('EncodingError');

    const { analysis: result } = await analyzer.analyze(file);

    expect(result.cuts).toEqual([1.2]);
    expect(result.beats).toEqual([]);
    expect(result.syncScore).toBeNull();
  });

  it('produit une analyse v2 complète et sa pellicule', async () => {
    const { analysis, filmstrip } = await analyzer.analyze(file);

    expect(analysis.fps).toBe(SAMPLE_FPS);
    expect(analysis.diffs.length).toBe(29);
    expect(analysis.diffs[11]).toBe(1);
    expect(analysis.palette).toEqual(['#000000', '#ffffff', '#ffffff']);
    expect(analysis.transitions).toEqual([{ time: 1.2, kind: 'cut' }]);
    expect(analysis.sensitivity).toBe(3);
    expect(analysis.thumbnailTimes).toEqual([0, 1.3]);
    expect(analyzer.drawnTimes).toEqual([0, 1.3]);
    expect(filmstrip?.type).toBe('image/jpeg');
    expect(analyzer.jpegQualities).toEqual([0.8]);
  });

  it('signale chaque image échantillonnée pour l’aperçu en direct', async () => {
    const samples: { time: number; diff: number; color: string }[] = [];
    await analyzer.analyze(file, { onSample: (sample) => samples.push(sample) });

    expect(samples.length).toBe(30);
    expect(samples[0]).toEqual({ time: 0, diff: 0, color: '#000000' });
    expect(samples[12]).toEqual({ time: 1.2, diff: 1, color: '#ffffff' });
  });

  it('réduit la qualité JPEG puis le nombre de cellules pour rester sous 1 Mo', async () => {
    analyzer.durationSec = 100;
    analyzer.levelAt = (timeSec) => (Math.floor(timeSec / 2) % 2 === 0 ? 0 : 255);
    analyzer.jpegSize = (canvas) => (canvas.width / 160) * 40000;

    const { analysis, filmstrip } = await analyzer.analyze(file);

    expect(analysis.cuts.length).toBe(49);
    expect(analyzer.drawnTimes.length).toBe(MAX_THUMBNAILS);
    expect(analyzer.jpegQualities).toEqual([0.8, 0.6, 0.4, 0.8]);
    expect(analysis.thumbnailTimes.length).toBe(21);
    expect(analysis.thumbnailTimes[0]).toBe(0);
    analysis.thumbnailTimes.slice(1).forEach((time, i) => expect(time).toBeGreaterThan(analysis.thumbnailTimes[i]));
    expect(filmstrip!.size).toBeLessThanOrEqual(MAX_FILMSTRIP_BYTES);
  });

  it('garde l’analyse sans pellicule si la capture échoue', async () => {
    analyzer.drawError = new Error('SecurityError');

    const { analysis, filmstrip } = await analyzer.analyze(file);

    expect(filmstrip).toBeNull();
    expect(analysis.thumbnailTimes).toEqual([]);
    expect(analysis.cuts).toEqual([1.2]);
  });

  it('recalcule l’analyse avec une autre sensibilité', async () => {
    const { analysis } = await analyzer.analyze(file);

    const strict = analyzer.rebuild(analysis, 9);
    const loose = analyzer.rebuild(analysis, 0);

    expect(strict.sensitivity).toBe(6);
    expect(strict.cuts).toEqual([]);
    expect(strict.transitions).toEqual([]);
    expect(loose.sensitivity).toBe(1);
    expect(loose.cuts).toEqual([1.2]);
    expect(loose.diffs).toBe(analysis.diffs);
  });

  describe('détection des beats dans un worker', () => {
    beforeEach(() => {
      analyzer.audio = { channels: [burstSignal(3, [0.5, 1.2, 2])], sampleRate: SAMPLE_RATE };
    });

    it('utilise les beats du worker et lui transfère les échantillons', async () => {
      analyzer.worker = new FakeWorker({ beats: [0.25, 1.7505] });

      const { analysis } = await analyzer.analyze(file);

      expect(analysis.beats).toEqual([0.25, 1.751]);
      expect(analyzer.worker.transfer.length).toBe(1);
      expect(analyzer.worker.terminated).toBe(true);
    });

    it('se replie sur le thread principal si le worker échoue', async () => {
      analyzer.worker = new FakeWorker('error');

      const { analysis } = await analyzer.analyze(file);

      expect(analysis.beats.length).toBe(3);
      expect(analyzer.worker.terminated).toBe(true);
    });

    it('se replie sur le thread principal sans Worker disponible', async () => {
      vi.stubGlobal('Worker', undefined);
      try {
        expect((await analyzer.analyze(file)).analysis.beats.length).toBe(3);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('propage l’annulation pendant la détection dans le worker', async () => {
      const controller = new AbortController();
      analyzer.worker = new FakeWorker('hang');

      const pending = analyzer.analyze(file, { signal: controller.signal });
      await vi.waitFor(() => expect(analyzer.worker!.transfer.length).toBe(1));
      controller.abort();

      await expect(pending).rejects.toMatchObject({ code: 'aborted' });
      expect(analyzer.worker.terminated).toBe(true);
    });
  });
});
