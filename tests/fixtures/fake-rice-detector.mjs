#!/usr/bin/env node
import { createInterface } from 'node:readline';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
// permissões de Calendário/Lembretes já concedidas (só para instâncias de documentação; os testes não definem isto)
// (com atraso: o app ainda está ligando o listener quando o processo sobe)
setTimeout(() => {
  if (process.env.FAKE_CALENDAR_ACCESS) out({ event: 'calendar-access', status: process.env.FAKE_CALENDAR_ACCESS });
  if (process.env.FAKE_REMINDERS_ACCESS) out({ event: 'reminders-access', status: process.env.FAKE_REMINDERS_ACCESS });
}, 1500);
for (const { at, line } of JSON.parse(process.env.FAKE_DETECTOR_SCRIPT ?? '[]')) setTimeout(() => out(line), at);
if (process.env.FAKE_DETECTOR_EXIT_AFTER_MS) setTimeout(() => process.exit(1), Number(process.env.FAKE_DETECTOR_EXIT_AFTER_MS));
createInterface({ input: process.stdin })
  .on('line', (l) => {
    const { cmd, from, to } = JSON.parse(l);
    if (cmd === 'list-events') out({ event: 'events-list', range: { from, to }, events: JSON.parse(process.env.FAKE_DETECTOR_LIST ?? '[]') });
    if (cmd === 'list-reminders') out({ event: 'reminders-list', reminders: JSON.parse(process.env.FAKE_DETECTOR_REMINDERS ?? '[]') });
    if (cmd === 'request-reminders-access') out({ event: 'reminders-access', status: process.env.FAKE_REMINDERS_AFTER_REQUEST ?? 'granted' });
    if (cmd === 'complete-reminder') out({ event: 'reminder-completed', id: JSON.parse(l).id, ok: process.env.FAKE_REMINDER_OK !== '0' });
    if (cmd === 'current-event') out(JSON.parse(process.env.FAKE_DETECTOR_CURRENT ?? '{"event":"current-event","id":null}'));
  })
  .on('close', () => process.exit(0));
setInterval(() => {}, 1000);
