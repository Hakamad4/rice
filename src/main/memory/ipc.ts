import type { MemoryService } from './service';

export type MemoryHost = {
  handle: (channel: string, fn: (e: unknown, ...args: any[]) => unknown) => void;
  send: (channel: string, payload: unknown) => void;
  /** Valida que a pasta é uma reunião dentro da raiz (o renderer nunca escolhe caminho). */
  checkedDir: (dir: unknown) => Promise<string>;
  readMeetingInfo: (dir: string) => Promise<{ title: string; date: string } | null>;
  setEnabled: (on: boolean) => Promise<void>;
  setNotify: (on: boolean) => Promise<void>;
  /** Integração com o app Lembretes ativa (macOS, permissão concedida, opção ligada). */
  remindersActive: () => Promise<boolean>;
  openFollowups?: () => void;
};

/** Canais `memory:*` e `followups:*`. Só entram ids (de fatos) e textos; nenhum caminho do renderer é aceito sem `checkedDir`. */
export function registerMemory(host: MemoryHost, service: MemoryService): void {
  const { handle } = host;
  handle('memory:status', () => service.status());
  handle('memory:set-enabled', async (_e, on: unknown) => {
    await host.setEnabled(on === true);
    return { ok: true as const, enabled: on === true };
  });
  handle('memory:set-notify', async (_e, on: unknown) => {
    await host.setNotify(on === true);
    return { ok: true as const, notify: on === true };
  });
  handle('memory:list', (_e, q: unknown) => service.list(q));
  handle('memory:update', async (_e, id: unknown, patch: unknown) => ({ ok: Boolean(await service.update(id, patch)) }));
  handle('memory:remove', async (_e, id: unknown) => ({ ok: await service.remove(id) }));
  handle('memory:forget', async (_e, kind: unknown, name: unknown) => ({ ok: true as const, removed: await service.forget(kind, name) }));
  handle('memory:clear', async () => {
    await service.clear();
    return { ok: true as const };
  });
  handle('memory:backfill-start', () => service.startBackfill());
  handle('memory:backfill-cancel', () => {
    service.cancelBackfill();
    return { ok: true as const };
  });
  handle('memory:brief-meeting', async (_e, rawDir: unknown) => service.briefForMeeting(await host.checkedDir(rawDir)));
  handle('memory:brief-event', (_e, id: unknown) => (typeof id === 'string' && id.length < 300 ? service.briefForEvent(id) : null));

  handle('followups:list', (_e, filter: unknown) => service.followups(filter));
  handle('followups:count', async () => ({ overdue: await service.overdueCount() }));
  handle('followups:set-done', async (_e, id: unknown, done: unknown) => ({ ok: Boolean(await service.setDone(id, done)) }));
  handle('followups:set-due', async (_e, id: unknown, due: unknown) => ({ ok: Boolean(await service.setDue(id, due)) }));
  handle('followups:add', async (_e, input: unknown) => {
    const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const dir = o.dir ? await host.checkedDir(o.dir) : undefined; // ligar a uma reunião: só pasta de reunião da raiz
    return { ok: Boolean(await service.addFollowup({ ...o, ...(dir ? { dir } : { dir: undefined }) }, host.readMeetingInfo)) };
  });
  handle('followups:toggle-note-task', async (_e, rawDir: unknown, text: unknown, checked: unknown) => ({ ok: await service.toggleNoteTask(await host.checkedDir(rawDir), text, checked) }));
  handle('followups:reminders-status', async () => ({ active: await host.remindersActive() }));
  handle('followups:to-reminders', async (_e, which: unknown) => {
    if (!(await host.remindersActive())) return { ok: false, count: 0 };
    return service.toReminders(which === 'mine' ? 'mine' : typeof which === 'string' ? which : '');
  });
}
