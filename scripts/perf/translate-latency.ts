// Latência real da tradução ao vivo: do trecho fechado até a tradução pronta (`ms` do resultado do TranslateService), por provedor.
// Usa o serviço e o runner de verdade (mesmo caminho do app, modelo leve do provedor). Nenhuma chave é lida do computador:
// chaves de API vêm só das variáveis RICE_BENCH_ANTHROPIC_KEY / RICE_BENCH_OPENAI_KEY / RICE_BENCH_GEMINI_KEY; CLIs usam o login que já existe.
// Uso: npx tsx scripts/perf/translate-latency.ts <claude-sub|chatgpt-sub|opencode-sub|claude-api|openai-api|gemini-api|local-model> [modelo] [trechos] [intervalo_ms]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTO_LIGHT, createRunnerFor } from '../../src/main/ai/factory';
import type { AiProvider } from '../../src/main/ai/types';
import { createStubOfflineTranslator } from '../../src/main/translate/offline';
import { TranslateService, type TranslateResult } from '../../src/main/translate/service';

const provider = process.argv[2] as AiProvider;
const model = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : AUTO_LIGHT[provider];
const count = Number(process.argv[4] ?? 8);
const gap = Number(process.argv[5] ?? 4000);
const KEYS: Partial<Record<AiProvider, string | undefined>> = { 'claude-api': process.env.RICE_BENCH_ANTHROPIC_KEY, 'openai-api': process.env.RICE_BENCH_OPENAI_KEY, 'gemini-api': process.env.RICE_BENCH_GEMINI_KEY };
const SAMPLES = [
  'Bom dia, pessoal, vamos começar pelo piloto com a Acme.',
  'O primeiro ponto é o cronograma das próximas semanas.',
  'A Ana consolida o roteiro de testes até sexta-feira.',
  'Depois voltamos ao orçamento, que está acima do previsto em quinze por cento.',
  'Eu levo a conversa com o cliente e trago a resposta na segunda.',
  'Precisamos decidir se o lançamento fica para o fim do trimestre ou para o começo do próximo.',
  'Alguém tem alguma objeção?',
  'Ótimo, então fechamos assim e eu mando a ata hoje à tarde.',
];

const dir = mkdtempSync(join(tmpdir(), 'rice-tr-bench-'));
const results: TranslateResult[] = [];
const notices: string[] = [];
const runner = createRunnerFor(provider, model ? { [provider]: model } : {}, {
  getSecret: async (p) => KEYS[p] ?? null,
  binaries: { claude: 'claude', codex: 'codex', opencode: 'opencode', agy: 'agy' },
  workDir: join(dir, 'cwd'),
});
const service = new TranslateService({
  ai: async () => ({ runner, provider, local: provider === 'local-model' }),
  offline: createStubOfflineTranslator(),
  startedAt: async () => new Date(),
  onResult: (r) => results.push(r),
  onNotice: (_d, n) => notices.push(n),
  onError: (e) => console.error('erro:', (e as Error).message),
});
service.start(dir, 'en');
for (let i = 0; i < count; i++) {
  await service.onSegment(dir, { id: `s${i}`, source: 'Outros', startMs: i * gap, endMs: i * gap + 2000, text: SAMPLES[i % SAMPLES.length]! });
  await new Promise((r) => setTimeout(r, gap));
}
await new Promise((r) => setTimeout(r, 30_000 > gap * 3 ? 15_000 : 5_000));
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const pick = (p: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
console.log(JSON.stringify({ provider, model: model ?? '(padrão)', gap, sent: count, translated: ms.length, notices, min: ms[0], p50: pick(0.5), p95: pick(0.95), max: ms.at(-1), all: results.map((r) => r.ms), sample: results[0]?.text }));
process.exit(0);
