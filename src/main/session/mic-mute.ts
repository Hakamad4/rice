/**
 * Aviso de "microfone parece mudo": o mic escolhido fica ~20 s sem voz enquanto o áudio do sistema tem fala. Só consome os frames que o pipeline
 * já recebe (nível por canal); não abre nada. Ouvir a reunião sem falar também deixa o mic quieto, então quem decide avisar (o main) só avisa se
 * OUTRA entrada tiver voz agora. No máximo um aviso por gravação, a menos que o microfone seja trocado de novo.
 */
export const MUTE_SILENCE_MS = 20_000;
const VOICE_DB = -42; // dBFS de um quadro de 100 ms: acima disso é fala/ruído alto, abaixo é silêncio ou ruído de fundo
const SYS_SPEECH_MS = 3_000; // quanto de fala do sistema, na janela, para valer

export function rmsDb(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return -120;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return 10 * Math.log10(Math.max(sum / n, 1e-12));
}

/** Janela deslizante em baldes de 1 s (21 baldes cobrem os 20 s): memória fixa, nenhuma alocação por frame. */
const BUCKETS = 21;

export class MicMuteMonitor {
  private epochStart = 0;
  private lastMicVoice = 0;
  private readonly sysSec = new Float64Array(BUCKETS); // qual segundo cada balde guarda
  private readonly sysMs = new Float64Array(BUCKETS).fill(0); // ms de fala do sistema naquele segundo
  private warned = false;
  private checkedAt = 0;
  private evaluatedAt = 0;

  /** Nova gravação ou microfone trocado: a contagem dos 20 s recomeça e o aviso volta a valer. */
  reset(now: number): void {
    this.epochStart = now;
    this.lastMicVoice = 0;
    this.sysSec.fill(-1);
    this.sysMs.fill(0);
    this.warned = false;
    this.checkedAt = 0;
    this.evaluatedAt = 0;
  }

  feed(source: 'mic' | 'sys', pcm: Buffer, now: number): void {
    if (rmsDb(pcm) <= VOICE_DB) return;
    if (source === 'mic') {
      this.lastMicVoice = now;
      return;
    }
    const sec = Math.floor(now / 1000);
    const i = sec % BUCKETS;
    if (this.sysSec[i] !== sec) {
      this.sysSec[i] = sec; // balde reaproveitado: o segundo antigo sai da janela
      this.sysMs[i] = 0;
    }
    this.sysMs[i]! += pcm.length / 32; // 16 kHz mono int16: 32 bytes por ms
  }

  private speechMs(now: number): number {
    const sec = Math.floor(now / 1000);
    let sum = 0;
    for (let i = 0; i < BUCKETS; i++) if (sec - this.sysSec[i]! <= MUTE_SILENCE_MS / 1000 && sec >= this.sysSec[i]!) sum += this.sysMs[i]!;
    return sum;
  }

  /** É hora de olhar as outras entradas? (mic sem voz há ≥ 20 s com fala do sistema; avalia no máx. 1x por segundo e olha no máx. 1x a cada 20 s). */
  due(now: number): boolean {
    if (this.warned || now - this.checkedAt < MUTE_SILENCE_MS) return false;
    if (now - Math.max(this.epochStart, this.lastMicVoice) < MUTE_SILENCE_MS) return false;
    if (now - this.evaluatedAt < 1000) return false;
    this.evaluatedAt = now;
    if (this.speechMs(now) < SYS_SPEECH_MS) return false;
    this.checkedAt = now;
    return true;
  }

  /** O aviso foi mostrado: não repete até trocar o microfone. */
  markWarned(): void {
    this.warned = true;
  }
}
