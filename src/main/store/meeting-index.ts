import { logWarn } from '../log';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { MeetingState, NotesStatus } from '../../shared/types';
import { listMeetingDirs, readMeetingText, readMeta } from './meeting-files';

export type MeetingSummary = {
  id: string;
  dir: string;
  title: string;
  startedAt: string;
  state: MeetingState;
  notesStatus: NotesStatus;
};

type Row = { id: string; dir: string; title: string; started_at: string; state: string; notes_status: string };

const toSummary = (r: Row): MeetingSummary => ({
  id: r.id,
  dir: r.dir,
  title: r.title,
  startedAt: r.started_at,
  state: r.state as MeetingState,
  notesStatus: r.notes_status as NotesStatus,
});

/** Converte texto livre em consulta FTS5 segura: cada palavra entre aspas, com prefixo. */
export function toFtsQuery(query: string): string | null {
  const words = query.normalize('NFC').match(/[\p{L}\p{N}]+/gu);
  if (!words || words.length === 0) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

export class MeetingIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        dir TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        state TEXT NOT NULL,
        notes_status TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
        id UNINDEXED, title, body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  }

  upsert(summary: MeetingSummary, body: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM meetings WHERE dir = ? AND id <> ?').run(summary.dir, summary.id);
      this.db
        .prepare(
          `INSERT INTO meetings (id, dir, title, started_at, state, notes_status)
           VALUES (@id, @dir, @title, @startedAt, @state, @notesStatus)
           ON CONFLICT(id) DO UPDATE SET dir = excluded.dir, title = excluded.title,
             started_at = excluded.started_at, state = excluded.state, notes_status = excluded.notes_status`,
        )
        .run(summary);
      this.db.prepare('DELETE FROM meetings_fts WHERE id = ?').run(summary.id);
      this.db.prepare('INSERT INTO meetings_fts (id, title, body) VALUES (?, ?, ?)').run(summary.id, summary.title, body);
    });
    tx();
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM meetings_fts WHERE id = ?').run(id);
    })();
  }

  clear(): void {
    this.db.exec('DELETE FROM meetings; DELETE FROM meetings_fts;');
  }

  list(): MeetingSummary[] {
    return (this.db.prepare('SELECT * FROM meetings ORDER BY started_at DESC').all() as Row[]).map(toSummary);
  }

  search(query: string): MeetingSummary[] {
    const fts = toFtsQuery(query);
    if (fts === null) return this.list();
    const rows = this.db
      .prepare(
        `SELECT m.* FROM meetings_fts f JOIN meetings m ON m.id = f.id
         WHERE meetings_fts MATCH ? ORDER BY f.rank, m.started_at DESC`,
      )
      .all(fts) as Row[];
    return rows.map(toSummary);
  }

  close(): void {
    this.db.close();
  }
}

export async function indexMeeting(index: MeetingIndex, dir: string): Promise<void> {
  const meta = await readMeta(dir);
  const parts = await Promise.all(
    (['transcript', 'annotations', 'notes'] as const).map((f) => readMeetingText(dir, f)),
  );
  index.upsert(
    { id: meta.id, dir, title: meta.title, startedAt: meta.startedAt, state: meta.state, notesStatus: meta.notesStatus },
    parts.join('\n\n'),
  );
}

export async function rebuildIndex(index: MeetingIndex, root: string): Promise<{ indexed: number; skipped: string[] }> {
  index.clear();
  const skipped: string[] = [];
  let indexed = 0;
  for (const dir of await listMeetingDirs(root)) {
    try {
      await indexMeeting(index, dir);
      indexed++;
    } catch (err) {
      logWarn('index: skipping an unreadable meeting', err);
      skipped.push(dir);
    }
  }
  return { indexed, skipped };
}
