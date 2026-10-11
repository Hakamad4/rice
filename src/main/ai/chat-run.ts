import { t, type UiLanguage } from '../i18n';
import type { AiRunner, AiRunOptions, ToolCall } from './types';

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
  chat: { useTools: boolean; /** War room: fontes liberadas para este chat (substitui `useTools`). */ access?: { mcp: boolean; web: boolean; folder?: string }; language: UiLanguage; onDelta: (text: string) => void; prefix?: string },
): Promise<string> {
  const lines: string[] = [];
  let streamed = chat.prefix ?? '';
  const emit = (text: string) => {
    streamed += text;
    chat.onDelta(text);
  };
  const run = runner.run({
    ...options,
    ...(chat.useTools || chat.access
      ? {
          tools: {
            ...(chat.access ? { mcp: chat.access.mcp, web: chat.access.web, ...(chat.access.folder ? { folder: chat.access.folder } : {}) } : {}),
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
      // com chamadas de ferramenta a resposta guardada é o que o usuário viu, na ordem; sem elas, o texto final do runner
      return lines.length > 0 ? streamed : (chat.prefix ?? '') + step.value;
    }
    emit(step.value);
  }
}
