import { describe, expect, test } from 'vitest';
import { consentOffer, normalizeConsentText } from '../../src/main/privacy/consent';
import { t } from '../../src/main/i18n';

const def = (lang: 'en' | 'pt-BR') => t('consent.default-text', undefined, lang);

describe('quando e com qual texto avisar', () => {
  test('ligado por padrão: oferece o aviso padrão no idioma da reunião', () => {
    expect(consentOffer({}, {}, 'pt-BR', def)).toEqual({ show: true, text: 'Aviso: estou usando o Rice para transcrever esta reunião localmente no meu computador, para minhas anotações. Se preferir que eu não transcreva, me avise.' });
    const en = consentOffer({}, {}, 'en', def);
    expect(en).toMatchObject({ show: true });
    expect((en as { text: string }).text).toMatch(/^Notice: I am using Rice to transcribe this meeting locally/);
  });

  test('opção desligada, ou aviso já copiado nesta reunião: nada aparece', () => {
    expect(consentOffer({ consentRemind: false }, {}, 'pt-BR', def)).toEqual({ show: false });
    expect(consentOffer({}, { consentNoticeCopiedAt: '2026-10-13T14:02:30-03:00' }, 'pt-BR', def)).toEqual({ show: false });
  });

  test('texto próprio vale para qualquer idioma; vazio ou só espaços volta ao padrão', () => {
    expect(consentOffer({ consentText: '  Estou gravando para ata.  ' }, {}, 'en', def)).toEqual({ show: true, text: 'Estou gravando para ata.' });
    expect(consentOffer({ consentText: '   ' }, {}, 'pt-BR', def)).toMatchObject({ text: def('pt-BR') });
  });

  test('texto do usuário é limpo: sem caracteres de controle e com no máximo 600 caracteres', () => {
    expect(normalizeConsentText('a\u0000b\u0007c')).toBe('abc');
    expect(normalizeConsentText('x'.repeat(900))).toHaveLength(600);
    expect(normalizeConsentText(42)).toBe('');
  });
});
