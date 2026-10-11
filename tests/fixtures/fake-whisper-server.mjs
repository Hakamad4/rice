#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (flag) => args[args.indexOf(flag) + 1];
const mode = process.env.FAKE_WHISPER_MODE ?? 'ok';

if (!existsSync(arg('-m'))) {
  console.error(`error: failed to load model '${arg('-m')}'`);
  process.exit(1);
}
if (arg('-l') !== 'pt') {
  console.error('error: expected -l pt');
  process.exit(1);
}

const loadedAt = Date.now() + 300;
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    if (mode === 'no-health') return res.writeHead(404).end();
    if (Date.now() < loadedAt) return res.writeHead(503, { 'content-type': 'application/json' }).end('{"status":"loading model"}');
    return res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  }
  if (req.method === 'GET' && req.url === '/') return res.writeHead(200).end('<html>whisper</html>');
  if (req.method === 'POST' && req.url === '/inference') {
    if (mode === 'crash-on-inference') process.exit(3);
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const size = body.length;
      const match = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('latin1'));
      const prompt = match ? Buffer.from(match[1], 'latin1').toString('utf8') : '';
      const lang = /name="language"\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('latin1'));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ` olá (${size} bytes) prompt=${prompt.length}${lang ? ` lang=${lang[1]}` : ''}` }));
    });
    return;
  }
  res.writeHead(404).end();
});
server.listen(Number(arg('--port')), arg('--host'));
