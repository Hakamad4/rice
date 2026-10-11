/**
 * R-33: o app da reunião soltou o microfone. Parar a gravação por isso é arriscado (pausa longa, troca de app, outra
 * chamada em seguida), então só se decide por "perguntar" ou "perguntar e parar sozinho". Nunca para sem aviso prévio.
 */
export const MIN_RECORDING_MS = 3 * 60_000;
export const CALENDAR_END_WINDOW_MS = 5 * 60_000;

export type EndDecision =
  /** Não faz nada: gravação curta demais, ninguém falou pelo sistema ainda, ou outra chamada segue ativa. */
  | 'ignore'
  /** Só avisa ("a reunião parece ter acabado") e deixa a gravação rodando até o usuário responder. */
  | 'ask'
  /** Avisa e, sem resposta, para: só quando o horário bate com o fim do evento da agenda. */
  | 'ask-then-stop';

export function decideMeetingEnd(input: {
  recordedMs: number;
  /** O áudio do sistema (os outros participantes) já produziu fala. */
  othersSpoke: boolean;
  /** Fim do evento da agenda ligado à reunião, se houver. */
  calendarEnd: Date | null;
  now: Date;
  /** Outro app de reunião continua usando o microfone. */
  otherCallActive: boolean;
}): EndDecision {
  if (input.otherCallActive) return 'ignore';
  if (input.recordedMs < MIN_RECORDING_MS) return 'ignore';
  if (!input.othersSpoke) return 'ignore';
  if (input.calendarEnd && Math.abs(input.now.getTime() - input.calendarEnd.getTime()) <= CALENDAR_END_WINDOW_MS) return 'ask-then-stop';
  return 'ask';
}
