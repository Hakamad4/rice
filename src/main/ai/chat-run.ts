import { t, type UiLanguage } from '../i18n';
import type { AiRunner, AiRunOptions, ToolCall, WebSource } from './types';
import { cleanSources, linksInText } from './web-search';

const SAFE = /[^A-Za-z0-9_.:-]/g;

/** Linha discreta que a resposta do chat mostra por chamada de ferramenta: "Ferramenta usada: notion · create_page". */
export function toolLine(call: ToolCall, language: UiLanguage): string {
  const detail = (call.detail ?? '').replace(/[\r\n*_`]+/g, ' ').trim().slice(0, 140);
  if (call.server === 'web') return `*${t(call.tool === 'WebFetch' ? 'warroom.tool.fetch' : 'warroom.tool.search', { detail }, language)}*`;
  if (call.server === 'file') return `*${t('warroom.tool.file', { detail }, language)}*`;
  return `*${t('chat.tool-used', { server: call.server.replace(SAFE, '').slice(0, 60), tool: call.tool.replace(SAFE, '').slice(0, 80) }, language)}*`;
}

/**
 * Roda uma pergunta do chat. Só quando `useTools` (opção do usuário ligada) o runner recebe o pedido de ferramentas; cada
 * chamada vira uma linha na resposta, no ponto em que aconteceu. Sem ferramentas o comportamento é o de sempre.
 * `prefix`: texto já enviado ao usuário antes (aviso de recuperação) e que também fica na resposta final.
 */
export async function runChat(
  runner: Pick<AiRunner, 'run'>,
  options: Omit<AiRunOptions, 'tools'>,
  chat: { useTools: boolean; /** War room: fontes liberadas para este chat (substitui `useTools`). */ access?: { mcp: boolean; web: boolean; folder?: string }; language: UiLanguage; onDelta: (text: string) => void; prefix?: string;
    /** "Buscar na web" ligado para ESTA pergunta (o chamador já conferiu que o provedor suporta). */ web?: boolean;
    /** Fontes da busca (https, sem repetir, as citadas primeiro), entregues uma vez ao fim da resposta. */ onSources?: (sources: WebSource[]) => void },
): Promise<string> {
  const lines: string[] = [];
  const found: WebSource[] = [];
  let streamed = chat.prefix ?? '';
  const emit = (text: string) => {
    streamed += text;
    chat.onDelta(text);
  };
  const run = runner.run({
    ...options,
    // o Rice mostra as fontes embaixo da resposta: sem endereços nem links em Markdown no texto
    ...(chat.web ? { system: `${options.system}\n\n${t('chat.web.system', undefined, chat.language)}` } : {}),
    ...(chat.useTools || chat.access || chat.web
      ? {
          tools: {
            // MCP só com a opção do chat ou o War room; a busca sozinha NÃO carrega MCPs
            ...(chat.access ? { mcp: chat.access.mcp, web: chat.access.web || chat.web === true, ...(chat.access.folder ? { folder: chat.access.folder } : {}) } : { mcp: chat.useTools, ...(chat.web ? { web: true } : {}) }),
            onSources: (sources: WebSource[]) => found.push(...sources),
            onCall: (call) => {
              const line = toolLine(call, chat.language);
              lines.push(line);
              emit(`\n\n${line}\n\n`);
            },
          },
        }
      : {}),
  });
  for (;;) {
    const step = await run.next();
    if (step.done) {
      const answer = lines.length > 0 ? streamed : (chat.prefix ?? '') + step.value;
      if (chat.web) chat.onSources?.(cleanSources(found.length > 0 ? found : linksInText(step.value), step.value));
      // com chamadas de ferramenta a resposta guardada é o que o usuário viu, na ordem; sem elas, o texto final do runner
      return answer;
    }
    emit(step.value);
  }
}
