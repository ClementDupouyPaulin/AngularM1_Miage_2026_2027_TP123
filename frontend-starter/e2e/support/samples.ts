import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SAMPLES_DIR = process.env['FILM_PULSE_SAMPLES'] ?? join(homedir(), 'Downloads', 'film-pulse-test');
export const REJECTED_DIR = join(SAMPLES_DIR, 'a-refuser');

export const SAMPLES_MISSING_REASON = `Échantillons absents (${SAMPLES_DIR}) : définissez FILM_PULSE_SAMPLES.`;

export function samplePath(name: string): string {
  return join(SAMPLES_DIR, name);
}

export function rejectedPath(name: string): string {
  return join(REJECTED_DIR, name);
}

export function sampleExists(path: string): boolean {
  return existsSync(path);
}
