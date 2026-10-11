import { describe, expect, test } from 'vitest';
import { encodeFrame, FrameDecoder, FRAME_HEADER_BYTES, MAX_FRAME_PAYLOAD_BYTES, type AudioFrame } from '../../src/shared/frames';

function frame(source: 'mic' | 'sys', ts: number, samples: number[]): AudioFrame {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(s, i * 2));
  return { source, timestampMs: ts, pcm };
}

describe('encodeFrame', () => {
  test('escreve cabeçalho de 13 bytes no layout do contrato', () => {
    const buf = encodeFrame(frame('sys', 1234, [1, -1]));
    expect(buf.length).toBe(FRAME_HEADER_BYTES + 4);
    expect(buf.readUInt8(0)).toBe(0x02);
    expect(buf.readBigUInt64LE(1)).toBe(1234n);
    expect(buf.readUInt32LE(9)).toBe(4);
    expect(buf.readInt16LE(13)).toBe(1);
    expect(buf.readInt16LE(15)).toBe(-1);
  });

  test('mic usa byte 0x01', () => {
    expect(encodeFrame(frame('mic', 0, [])).readUInt8(0)).toBe(0x01);
  });
});

describe('FrameDecoder', () => {
  test('decodifica vários frames em um único chunk', () => {
    const a = frame('mic', 0, [10, 20]);
    const b = frame('sys', 100, [30]);
    const out = new FrameDecoder().push(Buffer.concat([encodeFrame(a), encodeFrame(b)]));
    expect(out).toEqual([a, b]);
  });

  test('remonta frames entregues byte a byte', () => {
    const a = frame('mic', 5, [1, 2, 3]);
    const b = frame('sys', 6, [4]);
    const bytes = Buffer.concat([encodeFrame(a), encodeFrame(b)]);
    const dec = new FrameDecoder();
    const out: AudioFrame[] = [];
    for (let i = 0; i < bytes.length; i++) out.push(...dec.push(bytes.subarray(i, i + 1)));
    expect(out).toEqual([a, b]);
    expect(dec.pendingBytes).toBe(0);
  });

  test('cabeçalho cortado ao meio fica pendente até completar', () => {
    const a = frame('mic', 7, [9]);
    const bytes = encodeFrame(a);
    const dec = new FrameDecoder();
    expect(dec.push(bytes.subarray(0, 5))).toEqual([]);
    expect(dec.pendingBytes).toBe(5);
    expect(dec.push(bytes.subarray(5))).toEqual([a]);
  });

  test('o pcm devolvido não é afetado por mutações do chunk de entrada', () => {
    const bytes = encodeFrame(frame('mic', 0, [100]));
    const [out] = new FrameDecoder().push(bytes);
    bytes.fill(0);
    expect(out!.pcm.readInt16LE(0)).toBe(100);
  });

  test('byte de origem inválido lança erro', () => {
    const bytes = encodeFrame(frame('mic', 0, [1]));
    bytes.writeUInt8(0x09, 0);
    expect(() => new FrameDecoder().push(bytes)).toThrow('invalid frame source byte 0x9');
  });
});

describe('FrameDecoder limite de payload', () => {
  test('rejeita length acima do máximo assim que o cabeçalho chega', () => {
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt8(0x01, 0);
    header.writeUInt32LE(MAX_FRAME_PAYLOAD_BYTES + 1, 9);
    expect(() => new FrameDecoder().push(header)).toThrow(`frame payload too large: ${MAX_FRAME_PAYLOAD_BYTES + 1} bytes`);
  });

  test('aceita exatamente o máximo (aguarda payload)', () => {
    const header = Buffer.alloc(FRAME_HEADER_BYTES);
    header.writeUInt8(0x01, 0);
    header.writeUInt32LE(MAX_FRAME_PAYLOAD_BYTES, 9);
    expect(new FrameDecoder().push(header)).toEqual([]);
  });
});
