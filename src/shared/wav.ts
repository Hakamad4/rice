export function pcmToWav(pcm: Buffer, sampleRate = 16_000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function readWav(buf: Buffer): { sampleRate: number; channels: number; bitsPerSample: number; pcm: Buffer } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('arquivo não é WAV');
  }
  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const tag = buf.readUInt16LE(body);
      // 0xFFFE = WAVE_FORMAT_EXTENSIBLE (afconvert); o formato real fica nos 2 primeiros bytes do subformato
      const pcm = tag === 1 || (tag === 0xfffe && size >= 26 && buf.readUInt16LE(body + 24) === 1);
      if (!pcm) throw new Error('WAV não é PCM');
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bitsPerSample: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV sem chunk fmt antes de data');
      return { ...fmt, pcm: Buffer.from(buf.subarray(body, Math.min(body + size, buf.length))) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV sem chunk data');
}
