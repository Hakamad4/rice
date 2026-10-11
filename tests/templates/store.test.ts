import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID } from '../../src/main/templates/builtin';
import { validateTemplate } from '../../src/main/templates/schema';
import {
  deleteTemplate, getTemplate, listTemplates, loadUserTemplates, resolveTemplate, restoreBuiltinTemplate, saveTemplate, templatesDir,
} from '../../src/main/templates/store';
import { makeTmpDir } from '../helpers/tmp';

const sample = { title: 'Retro', description: 'Retrospectiva do sprint', icon: 'file-text', sections: [{ heading: 'Bom', description: 'O que foi bem' }] };

describe('embutidos', () => {
  test('seis templates em pt-BR, todos válidos, ids únicos, padrão é "Reunião geral"', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.title)).toEqual([
      'Reunião geral', '1:1', 'Daily / Stand-up', 'Entrevista de candidato', 'Reunião com cliente / vendas', 'Brainstorm',
    ]);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(6);
    expect(BUILTIN_TEMPLATES[0]!.id).toBe(DEFAULT_TEMPLATE_ID);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.builtin).toBe(true);
      expect(validateTemplate(t).ok, t.title).toBe(true);
      for (const s of t.sections) expect(s.description.length, `${t.title}/${s.heading}`).toBeGreaterThan(0);
    }
    expect(BUILTIN_TEMPLATES[0]!.sections.map((s) => s.heading)).toEqual(['Resumo', 'Decisões', 'Próximas ações', 'Pontos em aberto']);
  });
});

describe('validateTemplate', () => {
  test('aceita e normaliza espaços; o campo legado symbol/icon é ignorado (não entra no valor)', () => {
    const r = validateTemplate({ ...sample, title: '  Retro   do  time ', symbol: '🙂', icon: 'x' });
    expect(r).toMatchObject({ ok: true, value: { title: 'Retro do time' } });
    expect(r.ok && r.value).not.toHaveProperty('symbol');
    expect(r.ok && r.value).not.toHaveProperty('icon');
    expect(validateTemplate({ ...sample, symbol: 42 }).ok).toBe(true); // lixo no campo legado não bloqueia
  });

  test('ícones: embutidos têm ícone fixo por tipo; do usuário e overrides seguem a regra, e symbol antigo no arquivo é ignorado', async () => {
    const icons = Object.fromEntries(BUILTIN_TEMPLATES.map((t) => [t.id, t.icon]));
    expect(icons).toEqual({ 'reuniao-geral': 'file-text', 'um-a-um': 'users', daily: 'sun', 'entrevista-candidato': 'user-check', 'cliente-vendas': 'briefcase', brainstorm: 'lightbulb' });
    const root = await makeTmpDir();
    const dir = templatesDir(root);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'legado.json'), JSON.stringify({ title: 'Legado', symbol: '🔥', sections: [{ heading: 'A', description: '' }] }));
    await writeFile(join(dir, 'daily.json'), JSON.stringify({ title: 'Meu daily', symbol: '🙂', sections: [{ heading: 'A', description: '' }] }));
    const { templates } = await listTemplates(root);
    expect(templates.find((t) => t.id === 'legado')).toMatchObject({ icon: 'file-text', builtin: false });
    expect(templates.find((t) => t.id === 'legado')).not.toHaveProperty('symbol');
    expect(templates.find((t) => t.id === 'daily')).toMatchObject({ icon: 'sun', customized: true }); // override mantém o ícone do embutido
    const saved = await saveTemplate(root, { ...sample, id: 'novo', symbol: '🔁' } as never);
    expect(saved.icon).toBe('file-text');
    expect(JSON.parse(await readFile(join(dir, 'novo.json'), 'utf8'))).not.toHaveProperty('symbol');
  });

  test.each([
    ['não é objeto', 'x'],
    ['título vazio', { ...sample, title: '   ' }],
    ['título > 80', { ...sample, title: 'a'.repeat(81) }],
    ['descrição > 500', { ...sample, description: 'a'.repeat(501) }],
    ['sem seções', { ...sample, sections: [] }],
    ['13 seções', { ...sample, sections: Array.from({ length: 13 }, () => ({ heading: 'x', description: '' })) }],
    ['heading vazio', { ...sample, sections: [{ heading: ' ', description: '' }] }],
    ['heading > 80', { ...sample, sections: [{ heading: 'a'.repeat(81), description: '' }] }],
    ['descrição de seção > 500', { ...sample, sections: [{ heading: 'a', description: 'b'.repeat(501) }] }],
    ['seção não é objeto', { ...sample, sections: ['x'] }],
  ])('rejeita: %s', (_n, raw) => {
    expect(validateTemplate(raw).ok).toBe(false);
  });

  test('limites exatos passam (título 80, 12 seções, descrição 500)', () => {
    const sections = Array.from({ length: 12 }, () => ({ heading: 'h'.repeat(80), description: 'd'.repeat(500) }));
    expect(validateTemplate({ title: 't'.repeat(80), description: 'd'.repeat(500), icon: 'file-text', sections }).ok).toBe(true);
  });
});

describe('armazenamento do usuário', () => {
  test('sem pasta: só os embutidos, sem avisos', async () => {
    const root = await makeTmpDir();
    const { templates, warnings } = await listTemplates(root);
    expect(templates).toHaveLength(6);
    expect(warnings).toEqual([]);
  });

  test('CRUD: cria, lista após os embutidos, atualiza e apaga', async () => {
    const root = await makeTmpDir();
    const created = await saveTemplate(root, sample);
    expect(created).toMatchObject({ title: 'Retro', builtin: false });
    expect(created.id).toMatch(/^[\w-]+$/);
    const onDisk = JSON.parse(await readFile(join(templatesDir(root), `${created.id}.json`), 'utf8'));
    expect(onDisk).toMatchObject({ id: created.id, title: 'Retro' });
    expect(onDisk.builtin).toBeUndefined();

    let list = (await listTemplates(root)).templates;
    expect(list.map((t) => t.title)).toEqual([...BUILTIN_TEMPLATES.map((t) => t.title), 'Retro']);

    const updated = await saveTemplate(root, { ...sample, id: created.id, title: 'Retro v2' });
    expect(updated.id).toBe(created.id);
    expect((await getTemplate(root, created.id))?.title).toBe('Retro v2');
    list = (await listTemplates(root)).templates;
    expect(list).toHaveLength(7);

    await deleteTemplate(root, created.id);
    expect(await getTemplate(root, created.id)).toBeNull();
    await deleteTemplate(root, created.id); // idempotente
  });

  test('embutidos não são apagáveis (só restauráveis)', async () => {
    const root = await makeTmpDir();
    await expect(deleteTemplate(root, DEFAULT_TEMPLATE_ID)).rejects.toThrow(/embutidos/);
    await expect(restoreBuiltinTemplate(root, 'nao-existe')).rejects.toThrow(/embutidos/);
  });

  test('salvar um embutido grava override com o mesmo id; list/get devolvem o override', async () => {
    const root = await makeTmpDir();
    const saved = await saveTemplate(root, { ...sample, id: DEFAULT_TEMPLATE_ID, title: 'Geral do time' });
    expect(saved).toMatchObject({ id: DEFAULT_TEMPLATE_ID, title: 'Geral do time', builtin: true, customized: true });
    const onDisk = JSON.parse(await readFile(join(templatesDir(root), `${DEFAULT_TEMPLATE_ID}.json`), 'utf8'));
    expect(onDisk).toMatchObject({ id: DEFAULT_TEMPLATE_ID, title: 'Geral do time' });
    const { templates } = await listTemplates(root);
    expect(templates).toHaveLength(BUILTIN_TEMPLATES.length); // substitui, não duplica
    expect(templates[0]).toMatchObject({ id: DEFAULT_TEMPLATE_ID, title: 'Geral do time', builtin: true, customized: true });
    expect(templates[1]!.customized).toBeUndefined();
    expect(await getTemplate(root, DEFAULT_TEMPLATE_ID)).toMatchObject({ title: 'Geral do time', customized: true });
    expect((await resolveTemplate(root, 'sumiu')).title).toBe('Geral do time'); // o padrão também usa o override
  });

  test('restaurar apaga o override e volta ao embutido (idempotente)', async () => {
    const root = await makeTmpDir();
    await saveTemplate(root, { ...sample, id: DEFAULT_TEMPLATE_ID });
    const restored = await restoreBuiltinTemplate(root, DEFAULT_TEMPLATE_ID);
    expect(restored).toEqual(BUILTIN_TEMPLATES[0]);
    expect(await getTemplate(root, DEFAULT_TEMPLATE_ID)).toEqual(BUILTIN_TEMPLATES[0]);
    expect((await listTemplates(root)).templates[0]!.customized).toBeUndefined();
    await restoreBuiltinTemplate(root, DEFAULT_TEMPLATE_ID);
  });

  test('override inválido é ignorado com aviso e cai no embutido', async () => {
    const root = await makeTmpDir();
    await saveTemplate(root, sample);
    await writeFile(join(templatesDir(root), 'um-a-um.json'), JSON.stringify({ title: 'X', sections: [] }));
    const { templates, warnings } = await listTemplates(root);
    expect(warnings.join('\n')).toMatch(/um-a-um\.json/);
    expect(templates.find((t) => t.id === 'um-a-um')).toEqual(BUILTIN_TEMPLATES.find((t) => t.id === 'um-a-um'));
  });

  test('salvar inválido lança e não grava nada', async () => {
    const root = await makeTmpDir();
    await expect(saveTemplate(root, { ...sample, sections: [] })).rejects.toThrow(/seções/);
    expect((await loadUserTemplates(root)).templates).toEqual([]);
  });

  test('id com caminho não escapa da pasta', async () => {
    const root = await makeTmpDir();
    await expect(saveTemplate(root, { ...sample, id: '../../evil' })).rejects.toThrow(/inválido/);
    await expect(deleteTemplate(root, '../x')).rejects.toThrow(/inválido/);
    expect(await getTemplate(root, '../x')).toBeNull();
  });

  test('arquivos inválidos são ignorados com aviso e não derrubam a lista', async () => {
    const root = await makeTmpDir();
    const ok = await saveTemplate(root, sample);
    const dir = templatesDir(root);
    await writeFile(join(dir, 'quebrado.json'), '{ não é json');
    await writeFile(join(dir, 'sem-secoes.json'), JSON.stringify({ title: 'X', sections: [] }));
    await writeFile(join(dir, 'notas.txt'), 'ignorado em silêncio');
    await mkdir(join(dir, 'pasta.json'));
    const { templates, warnings } = await loadUserTemplates(root);
    expect(templates.map((t) => t.id)).toEqual([ok.id]);
    expect(warnings).toHaveLength(3);
    expect(warnings.join('\n')).toMatch(/quebrado\.json/);
    expect(warnings.join('\n')).toMatch(/sem-secoes\.json/);
  });

  test('resolveTemplate cai no padrão quando o id não existe mais', async () => {
    const root = await makeTmpDir();
    expect((await resolveTemplate(root)).id).toBe(DEFAULT_TEMPLATE_ID);
    expect((await resolveTemplate(root, 'sumiu')).id).toBe(DEFAULT_TEMPLATE_ID);
    expect((await resolveTemplate(root, 'brainstorm')).title).toBe('Brainstorm');
    const t = await saveTemplate(root, sample);
    expect((await resolveTemplate(root, t.id)).title).toBe('Retro');
  });
});

import { BUILTIN_TEMPLATES_EN, localizeTemplate } from '../../src/main/templates/builtin';

describe('templates embutidos em inglês', () => {
  test('todo embutido tem versão em inglês com as mesmas seções (quantidade) e texto preenchido', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const en = BUILTIN_TEMPLATES_EN[t.id];
      expect(en, t.id).toBeDefined();
      expect(en!.sections, t.id).toHaveLength(t.sections.length);
      for (const s of [{ heading: en!.title, description: en!.description }, ...en!.sections]) {
        expect(s.heading.trim()).not.toBe('');
        expect(s.description.trim()).not.toBe('');
      }
    }
  });

  test('localizeTemplate: só o embutido sem edição muda para inglês', () => {
    const base = BUILTIN_TEMPLATES[0]!;
    expect(localizeTemplate(base, 'en').sections[0]!.heading).toBe('Summary');
    expect(localizeTemplate(base, 'en').id).toBe(base.id);
    expect(localizeTemplate(base, 'pt-BR')).toBe(base);
    const edited = { ...base, customized: true, title: 'Meu geral' };
    expect(localizeTemplate(edited, 'en')).toBe(edited);
    const mine = { ...base, id: 'meu', builtin: false };
    expect(localizeTemplate(mine, 'en')).toBe(mine);
  });
});
