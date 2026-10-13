/** Hash perceptual (dHash 9x8): compara o brilho de pixels vizinhos numa miniatura em tons de cinza. Barato e estável a ruído de compressão. */
export const HASH_W = 9;
export const HASH_H = 8;

/** `gray`: HASH_W*HASH_H bytes (linha a linha). Devolve 64 bits em hexadecimal. */
export function dHash(gray: ArrayLike<number>): string {
  if (gray.length < HASH_W * HASH_H) throw new Error('miniatura pequena demais');
  let bits = 0n;
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      bits = (bits << 1n) | (gray[y * HASH_W + x]! > gray[y * HASH_W + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Tons de cinza de um bitmap BGRA (Electron) ou RGBA já no tamanho HASH_W x HASH_H. */
export function grayFromBitmap(bitmap: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = Math.round(0.114 * bitmap[o]! + 0.587 * bitmap[o + 1]! + 0.299 * bitmap[o + 2]!);
  }
  return out;
}

/** Diferente o bastante do último guardado? (≤ 5 de 64 bits = o mesmo conteúdo, só com cursor, relógio ou ruído.) */
export const SAME_THRESHOLD = 5;
export const isNearDuplicate = (a: string | null, b: string): boolean => a !== null && hamming(a, b) <= SAME_THRESHOLD;
