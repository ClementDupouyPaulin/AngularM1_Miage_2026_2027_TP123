import { detectBeats } from './beat-detector';

const SAMPLE_RATE = 8000;

/** Signal de `durationSec` avec une salve de 20 ms d'amplitude 0,8 à chaque instant de `onsets`. */
function impulseTrain(durationSec: number, onsets: number[]): Float32Array {
  const samples = new Float32Array(Math.round(durationSec * SAMPLE_RATE));
  const burstLength = Math.round(0.02 * SAMPLE_RATE);
  for (const onset of onsets) {
    const start = Math.round(onset * SAMPLE_RATE);
    for (let i = start; i < Math.min(samples.length, start + burstLength); i++) {
      samples[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
  }
  return samples;
}

describe('detectBeats', () => {
  it('trouve les beats d’un signal impulsionnel périodique aux bons instants', () => {
    const onsets = Array.from({ length: 8 }, (_, i) => 0.3 + i * 0.5);
    const beats = detectBeats(impulseTrain(4.5, onsets), SAMPLE_RATE);
    expect(beats.length).toBe(onsets.length);
    beats.forEach((beat, i) => expect(Math.abs(beat - onsets[i])).toBeLessThan(0.03));
  });

  it('ne trouve aucun beat dans le silence', () => {
    expect(detectBeats(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE)).toEqual([]);
  });

  it('respecte l’écart minimal entre deux beats', () => {
    const beats = detectBeats(impulseTrain(2, [0.5, 0.6, 1.5]), SAMPLE_RATE);
    expect(beats.length).toBe(2);
    expect(beats[1] - beats[0]).toBeGreaterThanOrEqual(0.25);
  });

  it('renvoie un tableau vide pour une fréquence d’échantillonnage invalide', () => {
    expect(detectBeats(new Float32Array(100), 0)).toEqual([]);
  });
});
