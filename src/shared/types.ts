export type Speaker = 'Eu' | 'Outros';

export type Segment = {
  id: string;
  source: Speaker;
  /** Relativo ao início da gravação. */
  startMs: number;
  endMs: number;
  text: string;
  /** "Pessoa N" do canal do sistema (identificação de participantes); ausente = só "Outros". */
  speaker?: number;
  /** Identifica o trecho de áudio (o mesmo dos parciais ao vivo); não é gravado em disco. */
  segmentId?: string;
};

/** Idioma falado na reunião (vai para o whisper e para os prompts): fixo dá a melhor qualidade; `auto` detecta. */
export type TranscriptionLanguage = 'pt' | 'en' | 'auto';
export const TRANSCRIPTION_LANGUAGES: readonly TranscriptionLanguage[] = ['pt', 'en', 'auto'];
export const isTranscriptionLanguage = (value: unknown): value is TranscriptionLanguage => TRANSCRIPTION_LANGUAGES.includes(value as TranscriptionLanguage);

/** `damaged`: só aparece na lista, para uma reunião cujo meta.json não dá para ler (ver `repairMeta`). */
export type MeetingState = 'draft' | 'recording' | 'finishing' | 'done' | 'interrupted' | 'damaged';
export type MeetingTrigger = 'manual' | 'mic' | 'calendar';
export type NotesStatus = 'pending' | 'done' | 'failed';

export type AudioGap = { fromMs: number; toMs: number; reason: string };

export type RecordingSession = { startedAt: string; endedAt?: string };

export type MeetingMeta = {
  id: string;
  title: string;
  /** ISO 8601 com offset local, ex.: 2026-10-08T14:30:00-03:00 */
  startedAt: string;
  /** Fim da última gravação. */
  endedAt?: string;
  /** Gravações da reunião (retomadas); ausente em reuniões antigas — use `meetingSessions`. */
  sessions?: RecordingSession[];
  state: MeetingState;
  trigger: MeetingTrigger;
  app?: string;
  calendarEventId?: string;
  /** E-mails dos participantes da agenda (sem o do usuário), guardados ao criar a reunião a partir de um evento. */
  participantEmails?: string[];
  notesStatus: NotesStatus;
  /** Template das notas; ausente = template padrão. */
  templateId?: string;
  /** Idioma falado nesta reunião; ausente = o padrão das configurações. */
  language?: TranscriptionLanguage;
  /** Pasta (agrupamento na barra lateral) em `<raiz>/.rice/folders.json`; só um rótulo: a pasta física da reunião não se move. */
  folderId?: string;
  /** Participantes do evento da agenda (nomes), guardados ao começar a gravar; entram no vocabulário. */
  participants?: string[];
  /** Nomes dados às pessoas identificadas: `{ "2": "Ana" }` para a "Pessoa 2". */
  speakers?: Record<string, string>;
  gaps: AudioGap[];
};

/** Pasta de agrupamento de reuniões. `parentId` ausente = pasta da raiz; `order` vale entre irmãs. */
export type Folder = { id: string; name: string; createdAt: string; order: number; parentId?: string };

/** Fonte da busca na web que a resposta usou (https). */
export type ChatSource = { url: string; title: string };
export type ChatTurn = { question: string; answer: string; /** Só nas respostas com "Buscar na web" ligado. */ sources?: ChatSource[] };

export type NoteTemplateSection = { heading: string; description: string };

export type NoteTemplate = {
  id: string;
  title: string;
  /** Que tipo de reunião é. */
  description: string;
  /** Nome de um ícone de linha (`icons.js`): fixo nos embutidos, `file-text` nos do usuário. */
  icon: string;
  /** Legado: arquivos antigos podem trazer um emoji; é ignorado na exibição e nunca mais gravado. */
  symbol?: string;
  sections: NoteTemplateSection[];
  builtin: boolean;
  /** Embutido com versão editada pelo usuário (override em `.rice/templates`). */
  customized?: boolean;
};

/** O que o editor envia ao salvar; sem `id` cria um template novo. */
export type NoteTemplateInput = Omit<NoteTemplate, 'id' | 'builtin' | 'icon' | 'symbol' | 'customized'> & { id?: string };
