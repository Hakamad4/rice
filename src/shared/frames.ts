export type AudioSource = 'mic' | 'sys';

export type AudioFrame = {
  source: AudioSource;
  timestampMs: number;
  pcm: Buffer;
};

export const FRAME_HEADER_BYTES = 13;
export const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;

const SOURCE_TO_BYTE: Record<AudioSource, number> = { mic: 0x01, sys: 0x02 };

function byteToSource(byte: number): AudioSource {
  if (byte === 0x01) return 'mic';
  if (byte === 0x02) return 'sys';
  throw new Error(`invalid frame source byte 0x${byte.toString(16)}`);
}

export function encodeFrame(frame: AudioFrame): Buffer {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt8(SOURCE_TO_BYTE[frame.source], 0);
  header.writeBigUInt64LE(BigInt(frame.timestampMs), 1);
  header.writeUInt32LE(frame.pcm.length, 9);
  return Buffer.concat([header, frame.pcm]);
}

/** Remonta frames a partir de chunks arbitrários do stdout do rice-audio. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  get pendingBytes(): number {
    return this.buffer.length;
  }

  push(chunk: Buffer): AudioFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: AudioFrame[] = [];
    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      const source = byteToSource(this.buffer.readUInt8(0));
      const length = this.buffer.readUInt32LE(9);
      if (length > MAX_FRAME_PAYLOAD_BYTES) throw new Error(`frame payload too large: ${length} bytes`);
      const end = FRAME_HEADER_BYTES + length;
      if (this.buffer.length < end) break;
      frames.push({
        source,
        timestampMs: Number(this.buffer.readBigUInt64LE(1)),
        pcm: Buffer.from(this.buffer.subarray(FRAME_HEADER_BYTES, end)),
      });
      this.buffer = this.buffer.subarray(end);
    }
    if (this.buffer.length === 0) this.buffer = Buffer.alloc(0);
    else this.buffer = Buffer.from(this.buffer);
    return frames;
  }
}
