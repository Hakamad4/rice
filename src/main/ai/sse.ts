export type SseEvent = { event: string; data: string };

/**
 * Parser de Server-Sent Events: aceita `\n` e `\r\n`, comentários (`:`), `data:` em várias linhas
 * e eventos cortados no meio entre dois pedaços. Termina quando o corpo acaba.
 */
export async function* parseSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const flush = (): SseEvent | null => {
    const out = data.length > 0 ? { event: event || 'message', data: data.join('\n') } : null;
    event = '';
    data = [];
    return out;
  };

  const feed = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      const e = flush();
      if (e) yield e;
    } else if (line.startsWith(':')) {
      // comentário / keep-alive
    } else {
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      let value = i === -1 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.search(/\r\n|\n|\r/)) !== -1) {
      const line = buffer.slice(0, nl);
      const sepLen = buffer.startsWith('\r\n', nl) ? 2 : 1;
      // um "\r" no fim do buffer pode ser o início de "\r\n": espera mais dados
      if (buffer[nl] === '\r' && nl + 1 === buffer.length) break;
      buffer = buffer.slice(nl + sepLen);
      yield* feed(line);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield* feed(buffer.replace(/\r$/, ''));
  const last = flush();
  if (last) yield last;
}
