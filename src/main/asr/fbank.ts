/**
 * Features log-mel estilo Kaldi (`compute-fbank-feats`), as mesmas que os modelos de voz 3D-Speaker/WeSpeaker esperam:
 * janela de 25 ms a cada 10 ms (povey), pré-ênfase 0,97, sem componente DC, FFT de 512, 80 filtros mel de 20 a 7600 Hz,
 * log da energia, sem dither e sem preencher as bordas (snip_edges).
 * Conferido contra o sherpa-onnx com o modelo 3D-Speaker CAM++ (scripts/perf/fbank-check.ts): similaridade de cosseno média
 * 0,985 entre os embeddings; vozes diferentes continuam bem separadas (ver relatório). O sherpa usa o mesmo caminho com
 * `normalize_samples` ligado: amostras em [-1, 1] sem escalar, e o filtro mel vai até 7600 Hz (Nyquist - 400).
 */
const SAMPLE_RATE = 16_000;
const FRAME_LEN = 400; // 25 ms
const FRAME_SHIFT = 160; // 10 ms
const FFT_SIZE = 512;
const MEL_BINS = 80;
const LOW_FREQ = 20;
const HIGH_FREQ = 7600;
const PREEMPH = 0.97;
const EPS = 1.1920928955078125e-7; // epsilon do float32, como no Kaldi

const mel = (hz: number): number => 1127 * Math.log(1 + hz / 700);

const WINDOW = Float32Array.from({ length: FRAME_LEN }, (_, i) => Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1)), 0.85));

/** Filtros triangulares: para cada bin mel, `[primeiroBin, pesos]` sobre os FFT_SIZE/2 + 1 bins de frequência. */
const FILTERS: Array<{ start: number; weights: Float32Array }> = (() => {
  const melLow = mel(LOW_FREQ);
  const melHigh = mel(HIGH_FREQ);
  const delta = (melHigh - melLow) / (MEL_BINS + 1);
  const binHz = SAMPLE_RATE / FFT_SIZE;
  const out: Array<{ start: number; weights: Float32Array }> = [];
  for (let b = 0; b < MEL_BINS; b++) {
    const left = melLow + b * delta;
    const center = melLow + (b + 1) * delta;
    const right = melLow + (b + 2) * delta;
    let start = -1;
    const weights: number[] = [];
    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      const m = mel(k * binHz);
      if (m > left && m < right) {
        if (start < 0) start = k;
        weights.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
      } else if (start >= 0) break;
    }
    out.push({ start: Math.max(start, 0), weights: Float32Array.from(weights) });
  }
  return out;
})();

const COS = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / FFT_SIZE));
const SIN = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / FFT_SIZE));
const REV = (() => {
  const bits = Math.log2(FFT_SIZE);
  return Uint16Array.from({ length: FFT_SIZE }, (_, i) => {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    return r;
  });
})();

/** FFT radix-2 in-place sobre (re, im). */
function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = REV[i]!;
    if (j > i) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step]!;
        const wi = SIN[k * step]!;
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** `[frames, 80]` achatado (linha a linha), com a média de cada dimensão já subtraída ("global-mean" dos modelos). */
export function logMelFeatures(samples: Float32Array): { data: Float32Array; frames: number } {
  const frames = samples.length < FRAME_LEN ? 0 : 1 + Math.floor((samples.length - FRAME_LEN) / FRAME_SHIFT);
  const data = new Float32Array(frames * MEL_BINS);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const frame = new Float64Array(FRAME_LEN);
  for (let f = 0; f < frames; f++) {
    const offset = f * FRAME_SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME_LEN; i++) {
      frame[i] = samples[offset + i]!;
      mean += frame[i]!;
    }
    mean /= FRAME_LEN;
    for (let i = 0; i < FRAME_LEN; i++) frame[i] = frame[i]! - mean; // sem DC
    re.fill(0);
    im.fill(0);
    for (let i = FRAME_LEN - 1; i > 0; i--) re[i] = (frame[i]! - PREEMPH * frame[i - 1]!) * WINDOW[i]!;
    re[0] = (frame[0]! - PREEMPH * frame[0]!) * WINDOW[0]!;
    fft(re, im);
    for (let b = 0; b < MEL_BINS; b++) {
      const { start, weights } = FILTERS[b]!;
      let energy = 0;
      for (let k = 0; k < weights.length; k++) {
        const bin = start + k;
        energy += weights[k]! * (re[bin]! * re[bin]! + im[bin]! * im[bin]!);
      }
      data[f * MEL_BINS + b] = Math.log(Math.max(energy, EPS));
    }
  }
  for (let b = 0; b < MEL_BINS && frames > 0; b++) {
    let sum = 0;
    for (let f = 0; f < frames; f++) sum += data[f * MEL_BINS + b]!;
    const mean = sum / frames;
    for (let f = 0; f < frames; f++) data[f * MEL_BINS + b] = data[f * MEL_BINS + b]! - mean;
  }
  return { data, frames };
}
