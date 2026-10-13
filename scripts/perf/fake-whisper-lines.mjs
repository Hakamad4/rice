#!/usr/bin/env node
// whisper-server falso para os testes de ponta a ponta: mesmo contrato (/health, /inference), mas devolve frases
// fictícias em sequência (uma por pedido) em vez de transcrever. Só para instâncias isoladas.
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (flag) => args[args.indexOf(flag) + 1];
const LINES = JSON.parse(process.env.FAKE_WHISPER_LINES ?? '["Vamos começar pelas metas do trimestre.","Esse gráfico mostra a receita recorrente por frente.","O piloto com a Acme é a maior barra e ainda tem espaço para crescer.","Agora a planilha de custos: a pesquisa está bem abaixo do orçado.","E aqui o fluxo dos dados entre as frentes."]');
// os pedidos incluem os parciais: a frase vem do TEMPO desde o primeiro pedido (uma por fatia), não da contagem
const SLOT_MS = Number(process.env.FAKE_WHISPER_SLOT_MS ?? 3500);
let first = 0;
createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  if (req.method === 'GET' && req.url === '/') return res.writeHead(200).end('<html>whisper</html>');
  if (req.method === 'POST' && req.url === '/inference') {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ` ${LINES[Math.floor((Date.now() - (first ||= Date.now())) / SLOT_MS) % LINES.length]}` })));
    return;
  }
  res.writeHead(404).end();
}).listen(Number(arg('--port')), arg('--host'));
