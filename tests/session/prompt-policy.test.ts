import { expect, test } from 'vitest';
import { shouldPromptEnd, shouldPromptStart, titleFor } from '../../src/main/session/prompt-policy';

test('start prompt only when idle and not already pending', () => {
  expect(shouldPromptStart({ state: 'idle', pending: new Set(), key: 'Chrome' })).toBe(true);
  expect(shouldPromptStart({ state: 'recording', pending: new Set(), key: 'Chrome' })).toBe(false);
  expect(shouldPromptStart({ state: 'finishing', pending: new Set(), key: 'Chrome' })).toBe(false);
  expect(shouldPromptStart({ state: 'idle', pending: new Set(['Chrome']), key: 'Chrome' })).toBe(false);
  expect(shouldPromptStart({ state: 'idle', pending: new Set(['Zoom']), key: 'Chrome' })).toBe(true);
});

test('end prompt only when recording that app and not pending', () => {
  expect(shouldPromptEnd({ state: 'recording', metaApp: 'Zoom', app: 'Zoom', pending: new Set() })).toBe(true);
  expect(shouldPromptEnd({ state: 'recording', metaApp: 'Zoom', app: 'Chrome', pending: new Set() })).toBe(false);
  expect(shouldPromptEnd({ state: 'recording', metaApp: undefined, app: 'Zoom', pending: new Set() })).toBe(false);
  expect(shouldPromptEnd({ state: 'idle', metaApp: 'Zoom', app: 'Zoom', pending: new Set() })).toBe(false);
  expect(shouldPromptEnd({ state: 'recording', metaApp: 'Zoom', app: 'Zoom', pending: new Set(['end:Zoom']) })).toBe(false);
});

test('titleFor prefers calendar title', () => {
  expect(titleFor({ calendarTitle: 'Daily', app: 'Zoom' })).toBe('Daily');
  expect(titleFor({ calendarTitle: '  ', app: 'Zoom' })).toBe('Reunião Zoom');
  expect(titleFor({ app: 'Zoom' })).toBe('Reunião Zoom');
});

import { isBrowserApp, PROMPT_COOLDOWN_MS, shouldOfferRecording } from '../../src/main/session/prompt-policy';

test('navegador só convida com evidência de reunião (evento da agenda agora); apps de reunião sempre', () => {
  const base = { muted: [], lastPromptAt: undefined, now: 1_000_000 };
  expect(isBrowserApp('Google Chrome')).toBe(true);
  expect(isBrowserApp('Zoom')).toBe(false);
  expect(shouldOfferRecording({ ...base, app: 'Google Chrome', calendarEvidence: false })).toBe(false); // ditado, gravador de voz...
  expect(shouldOfferRecording({ ...base, app: 'Google Chrome', calendarEvidence: true })).toBe(true);
  expect(shouldOfferRecording({ ...base, app: 'Zoom', calendarEvidence: false })).toBe(true);
});

test('"não perguntar mais" silencia o app; convites do mesmo app respeitam o intervalo mínimo', () => {
  const base = { calendarEvidence: true, now: 5 * PROMPT_COOLDOWN_MS };
  expect(shouldOfferRecording({ ...base, app: 'Zoom', muted: ['Zoom'], lastPromptAt: undefined })).toBe(false);
  expect(shouldOfferRecording({ ...base, app: 'Zoom', muted: ['Slack'], lastPromptAt: undefined })).toBe(true);
  expect(shouldOfferRecording({ ...base, app: 'Zoom', muted: [], lastPromptAt: base.now - 60_000 })).toBe(false);
  expect(shouldOfferRecording({ ...base, app: 'Zoom', muted: [], lastPromptAt: base.now - PROMPT_COOLDOWN_MS - 1 })).toBe(true);
});

import { PENDING_PROMPT_TTL_MS, PromptTracker } from '../../src/main/session/prompt-policy';

test('sem o close do macOS o convite pendente expira (TTL) e o 2º convite do mesmo app aparece', () => {
  let now = 1_000_000;
  const tracker = new PromptTracker(() => now);
  const decide = () => shouldPromptStart({ state: 'idle', pending: tracker, key: 'Zoom' }) && shouldOfferRecording({ app: 'Zoom', muted: [], calendarEvidence: true, lastPromptAt: tracker.lastDeclinedAt('Zoom'), now });
  expect(decide()).toBe(true);
  tracker.add('Zoom'); // banner mostrado; o close nunca chega
  now += PENDING_PROMPT_TTL_MS - 1;
  expect(decide()).toBe(false); // ainda em aberto
  now += 1;
  expect(decide()).toBe(true); // expirou sozinho, sem recusa registrada: não há intervalo de 20 min
});

test('recusa explícita respeita o intervalo de 20 min; aceitar não deixa intervalo', () => {
  let now = 5 * PROMPT_COOLDOWN_MS;
  const tracker = new PromptTracker(() => now);
  const offer = () => shouldOfferRecording({ app: 'Zoom', muted: [], calendarEvidence: true, lastPromptAt: tracker.lastDeclinedAt('Zoom'), now });
  tracker.declined('Zoom');
  now += PROMPT_COOLDOWN_MS - 1;
  expect(offer()).toBe(false);
  now += 1;
  expect(offer()).toBe(true);
  tracker.declined('Zoom');
  tracker.accepted('Zoom');
  expect(offer()).toBe(true);
});

test('ao terminar a gravação os convites de início pendentes caem (os de fim não)', () => {
  const tracker = new PromptTracker(() => 0);
  tracker.add('Zoom');
  tracker.add('end:Zoom');
  tracker.recordingEnded();
  expect(tracker.has('Zoom')).toBe(false);
  expect(tracker.has('end:Zoom')).toBe(true);
});
