import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { WarRoomEngine, ideasSystem, parseIdeas } from '../../src/main/warroom/engine';
import { BUILTIN_IDEA_TEMPLATES, deleteIdeaTemplate, ideaTemplatesDir, listIdeaTemplates, localizeIdeaTemplate, resolveIdeaTemplate, restoreBuiltinIdeaTemplate, saveIdeaTemplate, validateIdeaTemplate } from '../../src/main/warroom/idea-templates';
import { createWarRoom } from '../../src/main/warroom/ipc';
import { defaultConfig, normalizeConfig, readConfig, readIdeas, writeConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';

describe('embutidos, validação e CRUD', () => {
  test('7 embutidos, o Geral é o padrão; em inglês traduz; categorias dos embutidos', () => {
    expect(BUILTIN_IDEA_TEMPLATES.map((x) => x.id)).toEqual(['general', 'brainstorm', 'questions', 'risks', 'sales', 'interview', 'technical']);
    expect(BUILTIN_IDEA_TEMPLATES.every((x) => x.builtin && x.instruction && x.icon)).toBe(true);
    expect(localizeIdeaTemplate(BUILTIN_IDEA_TEMPLATES[4]!, 'en').title).toBe('Sales');
    expect(BUILTIN_IDEA_TEMPLATES[4]!.categories).toEqual(['Objeção', 'Sinal de compra', 'Próximo passo']);
  });
  test('validação: nome, instrução, categorias (únicas, no máx. 6 de 24 caracteres); espaços colapsados', () => {
    const ok = validateIdeaTemplate({ title: '  Meu   tipo ', description: ' d ', instruction: ' Faça X \n', categories: [' A ', 'a', 'B', ''] });
    expect(ok).toMatchObject({ ok: true, value: { title: 'Meu tipo', description: 'd', instruction: 'Faça X', categories: ['A', 'B'] } });
    for (const bad of [null, [], { title: '', instruction: 'x' }, { title: 'x'.repeat(81), instruction: 'x' }, { title: 'a', instruction: '' }, { title: 'a', instruction: 'x'.repeat(1201) }, { title: 'a', instruction: 'x', categories: ['x'.repeat(25)] }, { title: 'a', instruction: 'x', categories: ['1', '2', '3', '4', '5', '6', '7'] }]) {
      expect(validateIdeaTemplate(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  test('criar, listar (depois dos embutidos), editar embutido (override), restaurar padrão e apagar; ids seguros', async () => {
    const root = await makeTmpDir();
    const mine = await saveIdeaTemplate(root, { title: 'Cliente difícil', instruction: 'Aponte gatilhos de conflito', categories: ['Gatilho'] });
    expect(mine.builtin).toBe(false);
    expect(JSON.parse(await readFile(join(ideaTemplatesDir(root), `${mine.id}.json`), 'utf8'))).toMatchObject({ title: 'Cliente difícil', categories: ['Gatilho'] });
    let list = (await listIdeaTemplates(root)).templates;
    expect(list.map((x) => x.id).slice(-1)).toEqual([mine.id]);
    const edited = await saveIdeaTemplate(root, { id: 'sales', title: 'Vendas B2B', instruction: 'Foque em orçamento', categories: [] });
    expect(edited).toMatchObject({ builtin: true, customized: true });
    list = (await listIdeaTemplates(root)).templates;
    expect(list.find((x) => x.id === 'sales')).toMatchObject({ title: 'Vendas B2B', customized: true });
    expect((await restoreBuiltinIdeaTemplate(root, 'sales')).title).toBe('Vendas');
    expect((await listIdeaTemplates(root)).templates.find((x) => x.id === 'sales')!.customized).toBeUndefined();
    await expect(deleteIdeaTemplate(root, 'general')).rejects.toThrow();
    await deleteIdeaTemplate(root, mine.id);
    expect((await listIdeaTemplates(root)).templates.some((x) => x.id === mine.id)).toBe(false);
    await expect(saveIdeaTemplate(root, { id: '../fora', title: 'x', instruction: 'y' })).rejects.toThrow();
    await mkdir(ideaTemplatesDir(root), { recursive: true });
    await writeFile(join(ideaTemplatesDir(root), 'quebrado.json'), '{ ruim');
    expect((await listIdeaTemplates(root)).warnings).toHaveLength(1); // arquivo inválido é ignorado com aviso
    expect((await resolveIdeaTemplate(root, 'nao-existe')).id).toBe('general');
  });
});

describe('prompt e saída', () => {
  test('o Geral padrão mantém o prompt de sempre; outro template leva a instrução marcada como do usuário e as categorias; a SAFETY da transcrição continua', () => {
    const general = ideasSystem('pt-BR', BUILTIN_IDEA_TEMPLATES[0]);
    expect(general).not.toContain('Instrução do usuário');
    expect(general).not.toContain('category');
    const sales = ideasSystem('pt-BR', BUILTIN_IDEA_TEMPLATES[4]);
    expect(sales).toContain('Instrução do usuário para esta reunião (template "Vendas"): Identifique objeções');
    expect(sales).toContain('"category":"uma de: Objeção | Sinal de compra | Próximo passo"');
    expect(sales).toContain(ideasSystem('pt-BR').split('\n')[0]!.slice(0, 80)); // mesma abertura + SAFETY
    expect(ideasSystem('en', localizeIdeaTemplate(BUILTIN_IDEA_TEMPLATES[1]!, 'en'))).toContain('User instruction for this meeting (template "Brainstorm")');
  });
  test('parseIdeas só aceita categorias do template (o modelo não inventa rótulos)', () => {
    const out = '[{"kind":"idea","category":"objeção","text":"a"},{"kind":"idea","category":"Inventada","text":"b"},{"text":"c"}]';
    expect(parseIdeas(out, ['Objeção', 'Sinal de compra']).map((x) => x.category)).toEqual(['Objeção', undefined, undefined]);
    expect(parseIdeas(out).map((x) => x.category)).toEqual([undefined, undefined, undefined]);
  });
});

describe('por reunião, troca no meio e selo', () => {
  const speech = '**[00:00:00] Outros:** ' + 'precisamos decidir o preço do plano. '.repeat(10);
  function make(dir: string, systems: string[]) {
    return new WarRoomEngine({
      runner: () => ({ async *run(o: any) { systems.push(o.system); yield ''; return '[{"kind":"idea","category":"Alternativa","text":"ideia"}]'; } }) as any,
      transcript: async () => speech + 'x'.repeat(60 * systems.length), language: async () => 'pt-BR', support: async () => ({ web: false, mcp: false, folder: false }), emit: () => {},
      ideaTemplate: async (id) => (await resolveIdeaTemplate(dir, id)),
      minNewChars: 10,
    });
  }
  test('o ciclo usa o template da reunião; trocar no meio vale do próximo ciclo; cada ideia guarda o template que a gerou', async () => {
    const root = await makeTmpDir();
    const dir = await makeTmpDir();
    const systems: string[] = [];
    const engine = make(root, systems);
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 5, templateId: 'technical' } });
    expect(await engine.tick(dir, { manual: true })).toBe('ran');
    expect(systems[0]).toContain('template "Técnico"');
    await writeConfig(dir, { ...(await readConfig(dir)), ideas: { on: true, intervalMin: 5, templateId: 'sales' } }); // troca no meio
    expect(await engine.tick(dir, { manual: true })).toBe('ran');
    expect(systems[1]).toContain('template "Vendas"');
    const ideas = await readIdeas(dir);
    expect(ideas.map((i) => [i.templateId, i.templateTitle])).toEqual([['technical', 'Técnico'], ['sales', 'Vendas']]);
    expect(ideas[0]!.category).toBe('Alternativa'); // aceita a categoria do template Técnico
    expect(ideas[1]!.category).toBeUndefined(); // "Alternativa" não é categoria de Vendas
  });
  test('IPC: escolher o template vale por reunião, vira o último escolhido (padrão das novas) e id inexistente é ignorado', async () => {
    const root = await makeTmpDir();
    const handlers = new Map<string, (...a: any[]) => any>();
    let last: string | undefined;
    createWarRoom({
      handle: (c: string, fn: any) => void handlers.set(c, fn), send: () => {}, checkedDir: async (d: unknown) => String(d), runner: { async *run() { return '[]'; } } as any,
      provider: async () => 'claude-sub', language: async () => 'pt-BR', transcript: async () => '', isRecording: () => false, pickFolder: async () => null, saveAnnotations: async () => {}, userData: root, openPath: async () => '', openExternal: async () => {}, reveal: () => {},
      ideaTemplates: async () => ({ templates: (await listIdeaTemplates(root)).templates, ...(last ? { lastId: last } : {}) }), rememberIdeaTemplate: async (id: string) => void (last = id),
    } as any);
    const a = await makeTmpDir();
    const b = await makeTmpDir();
    await handlers.get('warroom:set')!(null, a, { ideaTemplate: 'risks' });
    expect((await readConfig(a)).ideas.templateId).toBe('risks');
    expect(last).toBe('risks');
    let view = await handlers.get('warroom:get')!(null, b); // reunião nova: herda o último escolhido
    expect(view.ideaTemplateId).toBe('risks');
    expect(view.ideaTemplates).toHaveLength(7);
    await handlers.get('warroom:set')!(null, b, { ideaTemplate: 'brainstorm' });
    view = await handlers.get('warroom:get')!(null, a);
    expect(view.ideaTemplateId).toBe('risks'); // por reunião: a outra não mudou
    await handlers.get('warroom:set')!(null, a, { ideaTemplate: 'inexistente' });
    expect((await readConfig(a)).ideas.templateId).toBe('risks');
  });
  test('migração: warroom.json sem templateId segue sem (resolve para o último/Geral)', () => {
    expect(normalizeConfig({ ideas: { on: true } }).ideas.templateId).toBeUndefined();
    expect(normalizeConfig({ ideas: { templateId: 'sales' } }).ideas.templateId).toBe('sales');
    expect(normalizeConfig({ ideas: { templateId: '../x' } }).ideas.templateId).toBeUndefined();
  });
});
