#!/usr/bin/env node
// Monta os arquivos da release de modelos de tradução (tag translation-models-v1) e o manifesto que o app embute.
//
//   node scripts/translation-models/build-release.mjs <plan.json> <pasta-de-saída>
//
// plan.json: { "tag": "translation-models-v1", "repo": "WalissonCF/rice",
//              "models": [{ "id", "dir", "source", "license" }],       // dir = pasta convertida (CTranslate2 int8)
//              "routes": { "pt>en": [{ "model", "tag"? }], ... },
//              "packs": { "pt": ["id", ...], "en": [], ... } }
// Saída: <pasta>/<id>.<arquivo> (um asset por arquivo, só o que o motor lê), SHA256SUMS, manifest.json, LICENSES.md e
//        src/main/translate/manifest-data.ts (SHA-256 e tamanhos fixos no app). NÃO publica nada: a release no GitHub é criada à mão.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [planPath, outArg] = process.argv.slice(2);
if (!planPath || !outArg) {
  console.error('uso: build-release.mjs <plan.json> <pasta-de-saida>');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const out = resolve(outArg);
const planDir = dirname(resolve(planPath));  // `dir` do plano é relativo a ele
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Só o que o rice-translate lê: pesos, vocabulário, config e o(s) sentencepiece. */
const WANTED = [/^model\.bin$/, /^config\.json$/, /^shared_vocabulary\.(json|txt)$/, /^source\.spm$/, /^target\.spm$/, /^sentencepiece\.model$/];
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const models = [];
const sums = [];
for (const m of plan.models) {
  const files = [];
  const modelDir = resolve(planDir, m.dir);
  for (const name of readdirSync(modelDir).sort()) {
    if (!WANTED.some((re) => re.test(name))) continue;
    const src = join(modelDir, name);
    const asset = `${m.id}.${name}`;
    copyFileSync(src, join(out, asset));
    const hash = sha256(src);
    files.push({ name, sha256: hash, bytes: statSync(src).size });
    sums.push(`${hash}  ${asset}`);
  }
  if (!files.some((f) => f.name === 'model.bin')) throw new Error(`${m.id}: sem model.bin em ${modelDir}`);
  models.push({ id: m.id, files });
}
writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);

const manifest = {
  version: 1,
  baseUrl: `https://github.com/${plan.repo}/releases/download/${plan.tag}`,
  models,
  routes: plan.routes,
  packs: plan.packs,
};
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const rows = plan.models.map((m) => `| \`${m.id}\` | ${m.source} | ${m.license} |`).join('\n');
writeFileSync(
  join(out, 'LICENSES.md'),
  `# Modelos de tradução do Rice / Rice translation models

Modelos OPUS-MT (Jörg Tiedemann, Helsinki-NLP / Universidade de Helsinque; Santhosh Thottingal), convertidos para CTranslate2 com
quantização int8 (\`ct2-transformers-converter --quantization int8\`). Nenhuma outra alteração nos pesos.
OPUS-MT models (Jörg Tiedemann, Helsinki-NLP / University of Helsinki; Santhosh Thottingal), converted to CTranslate2 with int8
quantization (\`ct2-transformers-converter --quantization int8\`). No other change to the weights.

| Modelo / Model | Origem / Source | Licença / License |
| --- | --- | --- |
${rows}

CC-BY-4.0: https://creativecommons.org/licenses/by/4.0/ — exige atribuição e indicação de alterações (feitas acima) / requires attribution
and a note of changes (given above).
Referência / Reference: Tiedemann & Thottingal (2020), "OPUS-MT — Building open translation services for the World", EAMT 2020.
`,
);

// Manifesto embutido no app: arquivo TS gerado (não editar à mão).
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../src/main/translate/manifest-data.ts');
writeFileSync(
  target,
  `// GERADO por scripts/translation-models/build-release.mjs — não edite à mão.\nimport type { Manifest } from './manifest';\n\nexport const TRANSLATION_MANIFEST: Manifest = ${JSON.stringify(manifest, null, 2)};\n`,
);
const total = models.reduce((n, m) => n + m.files.reduce((k, f) => k + f.bytes, 0), 0);
console.log(`ok: ${models.length} modelos, ${sums.length} arquivos, ${(total / 1e6).toFixed(0)} MB em ${out}`);
console.log(`manifesto: ${basename(target)}`);
