#!/usr/bin/env node
// MCP falso (stdio, JSON-RPC por linha) com uma ferramenta inofensiva `echo`: prova o fluxo de ferramentas sem usar nenhum MCP do usuário.
// Cada chamada grava uma linha em FAKE_MCP_LOG (se definido).
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const send = (obj) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...obj })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'echo', description: 'Devolve o texto recebido. Sem efeitos colaterais.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  else if (m.method === 'tools/call') {
    const text = String(m.params?.arguments?.text ?? '');
    if (process.env.FAKE_MCP_LOG) appendFileSync(process.env.FAKE_MCP_LOG, `${JSON.stringify({ tool: m.params?.name, text })}\n`);
    send({ id: m.id, result: { content: [{ type: 'text', text: `echo: ${text}` }] } });
  } else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });
});
