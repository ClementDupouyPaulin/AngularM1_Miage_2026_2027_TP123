/// <reference lib="webworker" />
import { detectBeats } from '../analysis/beat-detector';
import { BeatWorkerRequest, BeatWorkerResponse } from './analysis-worker.messages';

addEventListener('message', ({ data }: MessageEvent<BeatWorkerRequest>) => {
  let response: BeatWorkerResponse;
  try {
    response = { beats: detectBeats(data.samples, data.sampleRate) };
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) };
  }
  postMessage(response);
});
