/** Aviso de consentimento: quando mostrar e qual texto copiar (só lógica; o toast é UI e nunca mexe na gravação). */
export type ConsentSettings = { consentRemind?: boolean; consentText?: string };
export type ConsentOffer = { show: false } | { show: true; text: string };

/** Texto do usuário: sem caracteres de controle, até 600 caracteres; vazio = usar o padrão. */
export function normalizeConsentText(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 600) : '';
}

/**
 * Mostra o aviso se a opção estiver ligada (padrão) e o texto ainda não tiver sido copiado nesta reunião. O texto é o do usuário ou o
 * padrão no idioma DA REUNIÃO (`defaultText(lang)`).
 */
export function consentOffer(settings: ConsentSettings, meta: { consentNoticeCopiedAt?: string }, lang: 'en' | 'pt-BR', defaultText: (lang: 'en' | 'pt-BR') => string): ConsentOffer {
  if (settings.consentRemind === false || meta.consentNoticeCopiedAt) return { show: false };
  return { show: true, text: normalizeConsentText(settings.consentText) || defaultText(lang) };
}
