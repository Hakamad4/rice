/** Provedores de IA que o Rice sabe usar. Assinatura = login do usuário (CLI); API = chave própria cobrada por uso. */
export const AI_PROVIDERS = ['claude-sub', 'claude-api', 'chatgpt-sub', 'openai-api', 'gemini-api', 'opencode-sub', 'agy-sub', 'local-model'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_PROVIDER: AiProvider = 'claude-sub';

export const isProvider = (value: unknown): value is AiProvider => AI_PROVIDERS.includes(value as AiProvider);

/** Provedores que guardam um segredo (token ou chave) no Keychain. Os de login via CLI (codex) não têm. */
export const KEY_PROVIDERS = ['claude-sub', 'claude-api', 'openai-api', 'gemini-api'] as const satisfies readonly AiProvider[];
export type KeyProvider = (typeof KEY_PROVIDERS)[number];
export const hasKeyField = (provider: AiProvider): provider is KeyProvider => KEY_PROVIDERS.includes(provider as KeyProvider);

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  'claude-sub': 'Claude',
  'claude-api': 'Claude (API)',
  'chatgpt-sub': 'ChatGPT',
  'openai-api': 'OpenAI (API)',
  'gemini-api': 'Gemini (API)',
  'opencode-sub': 'OpenCode',
  'agy-sub': 'Antigravity',
  'local-model': 'Local model',
};

export type AiErrorKind = 'auth' | 'rate-limit' | 'network' | 'cancelled' | 'not-installed' | 'other';

/** Erro com mensagem já amigável (pt-BR), segura para mostrar no renderer. */
export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

/** Fonte de uma resposta com busca na web: título e endereço https (o domínio é calculado ao mostrar). */
export type WebSource = { url: string; title: string };

/** Uma chamada de ferramenta MCP feita pela IA durante a resposta (para mostrar ao usuário). */
export type ToolCall = { server: string; tool: string; /** Consulta, URL ou arquivo (busca/leitura do War room). */ detail?: string };

/**
 * Pedido de ferramentas, SÓ para o chat e SÓ quando o usuário ligou "Permitir ferramentas e MCPs no chat". Quem não passa
 * `tools` (notas, e-mail, sugestão de nomes, extrações) roda sempre sem nenhuma ferramenta.
 */
export type ToolsRequest = {
  onCall: (call: ToolCall) => void;
  /** MCPs do usuário (padrão: ligado; o chat usa só isto). */
  mcp?: boolean;
  /** Busca na internet: War room (fonte ligada) ou chat com "Buscar na web" ligado SÓ para aquela pergunta. Nunca dá shell (ver web-search.ts). */
  web?: boolean;
  /** Fontes que a busca na web trouxe (links https), na ordem em que chegam. */
  onSources?: (sources: WebSource[]) => void;
  /** War room: pasta de trabalho, SOMENTE LEITURA (já validada por `checkWorkFolder`). */
  folder?: string;
};

/** Imagem anexada (base64), só para as APIs que aceitam bloco de imagem; os CLIs a ignoram. */
export type AiImage = { mime: string; data: string };
/** De que reunião(ões) e para quê é a chamada: serve só para o recibo de privacidade (metadados, nunca conteúdo). */
export type EgressKind = 'notes' | 'chat' | 'ideas' | 'warroom' | 'screenshot' | 'memory' | 'email-draft' | 'translate' | 'other';
export type EgressContext = { kind: EgressKind; dir?: string; dirs?: readonly string[] };
export type AiRunOptions = { system: string; prompt: string; signal?: AbortSignal; tools?: ToolsRequest; images?: AiImage[]; egress?: EgressContext };

/** Mesma forma do `ClaudeRunner`: emite pedaços de texto e devolve o texto completo. */
export interface AiRunner {
  run(options: AiRunOptions): AsyncGenerator<string, string, void>;
}

/** Quanto tempo esperamos uma resposta inteira (notas de reuniões longas demoram). */
export const RUN_TIMEOUT_MS = 10 * 60_000;
