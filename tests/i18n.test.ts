import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Caminhos com `/` em qualquer sistema (as listas de exceções abaixo são escritas assim). */
const posixPath = (p: string): string => p.split(sep).join('/');
import { beforeAll, describe, expect, test } from 'vitest';

const load = (): any => {
  new Function(readFileSync('src/renderer/i18n.js', 'utf8'))(); // registra globalThis.RiceI18n (instância nova a cada carga)
  return (globalThis as any).RiceI18n;
};

describe('motor de i18n', () => {
  test('t substitui variáveis, cai no pt-BR e devolve a chave quando não existe', () => {
    const i18n = load();
    i18n.add('pt-BR', { a: 'Olá, {nome}! Você tem {n} itens.', so_pt: 'só em português' });
    i18n.add('en', { a: 'Hi, {nome}! You have {n} items.' });
    expect(i18n.t('a', { nome: 'Ana', n: 3 })).toBe('Olá, Ana! Você tem 3 itens.');
    i18n.setLanguage('en');
    expect(i18n.t('a', { nome: 'Ana', n: 3 })).toBe('Hi, Ana! You have 3 items.');
    expect(i18n.t('so_pt')).toBe('só em português'); // fallback
    expect(i18n.t('nao_existe')).toBe('nao_existe');
    expect(i18n.t('a', { nome: 'Ana' })).toBe('Hi, Ana! You have {n} items.'); // variável ausente fica como está
    expect(i18n.t('a', { nome: 'Bia', n: 1 }, 'pt-BR')).toBe('Olá, Bia! Você tem 1 itens.'); // idioma explícito
  });

  test('tn escolhe singular/plural; setLanguage ignora idioma desconhecido; locale para Intl', () => {
    const i18n = load();
    i18n.add('pt-BR', { 'x.one': '{n} agenda', 'x.other': '{n} agendas' });
    i18n.add('en', { 'x.one': '{n} calendar', 'x.other': '{n} calendars' });
    expect(i18n.tn('x', 1)).toBe('1 agenda');
    expect(i18n.tn('x', 2)).toBe('2 agendas');
    i18n.setLanguage('en');
    expect(i18n.tn('x', 2)).toBe('2 calendars');
    expect(i18n.setLanguage('fr')).toBe('pt-BR');
    expect(i18n.locale('en')).toBe('en-US');
    expect(i18n.locale('pt-BR')).toBe('pt-BR');
  });

  test('idioma inicial pelo locale do sistema: pt* → pt-BR, senão en', () => {
    const i18n = load();
    expect(i18n.fromSystemLocale('pt-BR')).toBe('pt-BR');
    expect(i18n.fromSystemLocale('pt-PT')).toBe('pt-BR');
    expect(i18n.fromSystemLocale('en-US')).toBe('en');
    expect(i18n.fromSystemLocale('de')).toBe('en');
    expect(i18n.fromSystemLocale(undefined)).toBe('en');
  });
});

/** Carrega o motor com todos os dicionários de `locales/` (como o renderer e o main fazem). */
function loadAll(): any {
  const api = load();
  for (const file of readdirSync('src/renderer/locales').sort()) new Function(readFileSync(join('src/renderer/locales', file), 'utf8'))();
  return api;
}

describe('dicionários', () => {
  let api: any;
  beforeAll(() => {
    api = loadAll();
  });

  test('pt-BR e en têm exatamente as mesmas chaves', () => {
    const pt = Object.keys(api.dictionaries['pt-BR']).sort();
    const en = Object.keys(api.dictionaries.en).sort();
    expect(pt.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !pt.includes(k))).toEqual([]);
    expect(pt.length).toBeGreaterThan(0);
  });

  test('as mesmas variáveis {x} aparecem nos dois idiomas e não há texto vazio', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(api.dictionaries['pt-BR'])) {
      const pt = api.dictionaries['pt-BR'][key];
      const en = api.dictionaries.en[key];
      expect(pt.trim(), key).not.toBe('');
      expect(en.trim(), key).not.toBe('');
      expect(vars(en), key).toEqual(vars(pt));
    }
  });
});

describe('cobertura das chaves e textos fixos', () => {
  const files = (dir: string, ext: string[]): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), ext) : ext.some((x) => e.name.endsWith(x)) ? [posixPath(join(dir, e.name))] : []));
  let api: any;
  beforeAll(() => {
    api = loadAll();
  });

  test('toda chave usada em t()/tn()/data-i18n existe nos dois dicionários', () => {
    const missing: string[] = [];
    const sources = [...files('src/renderer', ['.js', '.html']).filter((f) => !f.includes('locales') && !f.endsWith('i18n.js')), ...files('src/main', ['.ts', '.cjs'])];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(?:t|tr)\(\s*'([a-z0-9][a-z0-9.\-]*)'/g)) {
        for (const lang of ['pt-BR', 'en']) if (api.dictionaries[lang][m[1]!] === undefined) missing.push(`${file}: ${m[1]} (${lang})`);
      }
      for (const m of text.matchAll(/\btn\(\s*'([a-z0-9][a-z0-9.\-]*)'/g)) {
        for (const lang of ['pt-BR', 'en']) for (const form of ['one', 'other']) if (api.dictionaries[lang][`${m[1]}.${form}`] === undefined) missing.push(`${file}: ${m[1]}.${form} (${lang})`);
      }
      for (const m of text.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([^"]+)"/g)) {
        for (const lang of ['pt-BR', 'en']) if (api.dictionaries[lang][m[1]!] === undefined) missing.push(`${file}: ${m[1]} (${lang})`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('chaves montadas dinamicamente existem para todos os valores possíveis', () => {
    const keys = [
      ...['claude-sub', 'claude-api', 'openai-api', 'gemini-api'].map((p) => `ai.key.${p}`),
      ...['chatgpt-sub'].map((p) => `ai.err.auth.${p}`),
      ...['notes', 'annotations', 'transcript', 'title', 'folder'].map((f) => `search.in.${f}`),
      ...['pt', 'en', 'auto'].flatMap((l) => [`lang.picker.${l}`, `lang.picker.opt-${l}`]),
    ];
    for (const key of keys) for (const lang of ['pt-BR', 'en']) expect(api.dictionaries[lang][key], `${key} (${lang})`).toBeDefined();
  });

  test('não sobrou texto em português fixo nos arquivos do renderer (fora do i18n e dos dicionários)', () => {
    const accented = /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/;
    const offenders: string[] = [];
    for (const file of files('src/renderer', ['.js', '.html'])) {
      if (file.includes('locales') || file.endsWith('i18n.js')) continue;
      let text = readFileSync(file, 'utf8');
      text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
      text.split('\n').forEach((line, i) => {
        const code = file.endsWith('.js') ? line.replace(/(^|[^:'"`])\/\/.*$/, '$1') : line;
        if (!accented.test(code)) return;
        if (/data-i18n/.test(code)) return; // texto de reserva do HTML estático: o motor troca ao carregar
        offenders.push(`${file}:${i + 1}: ${code.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('textos do main que chegam à tela', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|cjs)$/.test(e.name) ? [posixPath(join(dir, e.name))] : []));

  // fora da varredura: o conteúdo dos prompts/templates (é o que o modelo lê/escreve) e diagnósticos técnicos de ASR,
  // caminhos de arquivo e logs, que não são texto de interface
  const allowFile = /^src\/main\/asr\/|(claude\/prompts\.ts|warroom\/engine\.ts|claude\/global-chat\.ts|claude\/follow-up\.ts|session\/chat-context\.ts|templates\/builtin\.ts|warroom\/idea-templates\.ts|session\/audio-capture\.ts|store\/meeting-index\.ts|app\/paths\.ts)$/;
  const allowLine = /console\.|canal não permitido|Responda só: ok|migração do token/;

  test('nenhuma string em português fixo no main fora da lista de exceções', () => {
    const accented = /'[^'\\\n]*[áéíóúâêôãõçÁÉÍÓÚ][^'\\\n]*'|`[^`\\\n]*[áéíóúâêôãõçÁÉÍÓÚ][^`\\\n]*`/;
    const offenders: string[] = [];
    for (const file of files('src/main')) {
      if (allowFile.test(file)) continue;
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      text.split('\n').forEach((line, i) => {
        const code = line.replace(/(^|[^:'"`])\/\/.*$/, '$1');
        if (accented.test(code) && !allowLine.test(code)) offenders.push(`${file}:${i + 1}: ${code.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('português SEM acento fixo (a varredura por acento não pega)', () => {
  const files = (dir: string, ext: RegExp): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), ext) : ext.test(e.name) ? [posixPath(join(dir, e.name))] : []));
  // palavras de interface que só existem em português (nada de "Meet", "Login", "Rice")
  const PT = /\b(Salve|Conecte|Falha|recusou|desconectado|expirou|Nenhum|Nenhuma|Salvar|Cancelar|Apagar|Abrir|Fechar|Copiar|Enviar|Buscar|Pergunte|Gravar|Escolha|Tente|Informe|Carregando|Verificando)\b/;
  const strings = /'[^'\\\n]*'|`[^`\\\n]*`|"[^"\\\n]*"/g;
  const allow = /^src\/main\/asr\/|(claude\/(prompts|global-chat|follow-up)\.ts|warroom\/engine\.ts|templates\/builtin\.ts|session\/audio-capture\.ts|store\/meeting-index\.ts|app\/paths\.ts)$/;

  test('main: nenhuma string de interface em português sem passar por t()', () => {
    const offenders: string[] = [];
    for (const file of [...files('src/main', /\.(ts|cjs)$/), ...files('src/shared', /\.ts$/)]) {
      if (allow.test(file)) continue;
      readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((line, i) => {
        const code = line.replace(/(^|[^:'"`])\/\/.*$/, '$1');
        if (/console\.|canal/.test(code)) return;
        for (const m of code.matchAll(strings)) if (PT.test(m[0])) offenders.push(`${file}:${i + 1}: ${m[0].slice(0, 70)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('renderer: idem (texto de reserva do HTML com data-i18n é trocado ao carregar)', () => {
    const offenders: string[] = [];
    for (const file of files('src/renderer', /\.(js|html)$/)) {
      if (file.includes('locales') || file.endsWith('i18n.js')) continue;
      readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').forEach((line, i) => {
        if (/data-i18n/.test(line)) return;
        const code = file.endsWith('.js') ? line.replace(/(^|[^:'"`])\/\/.*$/, '$1') : line;
        for (const m of code.matchAll(strings)) if (PT.test(m[0])) offenders.push(`${file}:${i + 1}: ${m[0].slice(0, 70)}`);
      });
    }
    expect(offenders.filter((o) => !/index\.html:\d+: .*(rec-label|Gravar)/.test(o))).toEqual([]);
  });
});
