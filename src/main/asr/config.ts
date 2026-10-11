import { homedir, availableParallelism } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from '../app/paths';

export function riceDataDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'Rice');
}

export function modelsDir(): string {
  return join(riceDataDir(), 'models');
}

export function whisperServerBinary(): string {
  return process.env.RICE_WHISPER_SERVER ?? '/opt/homebrew/bin/whisper-server';
}

export function sileroModelPath(): string {
  // Não usar import.meta.url: no bundle CJS do Electron ele fica vazio ("Invalid URL").
  return process.env.RICE_SILERO_MODEL ?? join(repoRoot(), 'resources', 'models', 'silero_vad.onnx');
}

export function defaultThreads(): number {
  return Math.max(2, Math.min(8, availableParallelism() - 2));
}
