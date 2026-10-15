const pad = (n: number) => String(n).padStart(2, '0');

const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/g;
const MAX_TITLE = 80;

export function sanitizeTitle(title: string, fallback = 'Reunião'): string {
  const cleaned = title
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '') // o Windows descarta ponto e espaço no fim do nome da pasta: o caminho gravado deixaria de existir
    .trim();
  const chars = Array.from(cleaned).slice(0, MAX_TITLE).join('').trim();
  return chars || fallback;
}

export function meetingFolderName(startedAt: Date, title: string): string {
  const d = startedAt;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}${pad(d.getMinutes())} - ${sanitizeTitle(title)}`;
}

export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function toLocalIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${formatClock(date)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
