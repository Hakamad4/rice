import { afterEach, expect, test } from 'vitest';
import { friendlyMessage } from '../src/main/ai/errors';
import { validateKey } from '../src/main/ai/secrets';
import { getLanguage, setLanguage, t, fromSystemLocale } from '../src/main/i18n';
import { titleFor } from '../src/main/session/prompt-policy';
import { validateTemplate } from '../src/main/templates/schema';

afterEach(() => setLanguage('pt-BR'));

test('mensagens do main saem no idioma do app (pt-BR por padrão, en quando trocado)', () => {
  expect(getLanguage()).toBe('pt-BR');
  expect(friendlyMessage('claude-api', 'auth')).toBe('A chave de API do Claude foi recusada. Confira se ela está correta e ativa e salve de novo.');
  setLanguage('en');
  expect(friendlyMessage('claude-api', 'auth')).toBe('The Claude API key was rejected. Check that it is correct and active, and save it again.');
  expect(friendlyMessage('openai-api', 'rate-limit')).toBe('OpenAI usage limit reached. Try again later.');
  const bad = validateKey('openai-api', 'xyz');
  expect(bad.ok === false && bad.message).toContain('OpenAI key must start with');
  const tpl = validateTemplate({ title: '', sections: [] });
  expect(tpl.ok === false && tpl.message).toBe('The title must be 1 to 80 characters long.');
  expect(titleFor({ app: 'Zoom' })).toBe('Zoom meeting');
  expect(t('meeting.default-title')).toBe('Meeting');
});

test('o idioma volta ao pt-BR e o inicial vem do locale do sistema', () => {
  setLanguage('en');
  setLanguage('pt-BR');
  expect(t('meeting.default-title')).toBe('Reunião');
  expect(fromSystemLocale('pt-BR')).toBe('pt-BR');
  expect(fromSystemLocale('en-GB')).toBe('en');
});
