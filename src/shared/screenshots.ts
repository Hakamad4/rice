/** Capturas de tela ligadas à reunião: tipos e regras de nome compartilhadas entre o main e os testes (o renderer repete a regex). */

/** Nome de arquivo aceito em `capturas/`: HHMMSS (relógio local), com sufixo -N se o segundo repetir. Nada além disso passa pelo IPC. */
export const SHOT_FILE_RE = /^\d{6}(?:-\d{1,2})?\.jpg$/;
/** Id de uma captura numa nota: o nome sem a extensão. */
export const SHOT_ID_RE = /^\d{6}(?:-\d{1,2})?$/;

export const SHOTS_DIR = 'capturas';
export const SHOTS_INDEX = 'capturas.json';

export type Shot = {
  file: string;
  /** Instante da captura (ISO local). */
  at: string;
  /** Posição na gravação (ms). */
  offsetMs: number;
  /** Legenda curta; vazia quando o provedor não aceita imagem. */
  caption: string;
  /** Relógio (HH:MM:SS) do trecho da transcrição mais próximo, ou null. */
  segment: string | null;
  /** O trecho da fala que motivou a captura (a miniatura fica logo depois dele). Ausente nas capturas manuais. */
  trigger?: { segmentAt: string; text: string };
  /** Tirada pelo botão ou pelo atalho, não pela IA. */
  manual?: boolean;
};

export const isShotFile = (name: unknown): name is string => typeof name === 'string' && SHOT_FILE_RE.test(name);
export const shotId = (file: string): string => file.replace(/\.jpg$/, '');
