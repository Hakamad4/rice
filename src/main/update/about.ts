/** "Qual cópia está aberta": versão, commit do build e o caminho do app em execução (para Configurações › Atualizações). */
export type AppAbout = { version: string; commit: string | null; /** O commit inteiro (para os detalhes técnicos). */ commitFull: string | null; appPath: string };

/** O caminho do pacote .app a partir do executável (".../Rice.app/Contents/MacOS/Rice" -> ".../Rice.app"); sem .app, o próprio caminho. */
export function bundlePath(exePath: string): string {
  const m = /^(.*?\.app)(?:\/|$)/.exec(exePath);
  return m ? m[1]! : exePath;
}

export function appAbout(input: { version: string; commit: string | null | undefined; exePath: string }): AppAbout {
  const valid = input.commit && /^[0-9a-f]{7,40}$/i.test(input.commit) ? input.commit : null;
  return { version: input.version, commit: valid ? valid.slice(0, 7) : null, commitFull: valid, appPath: bundlePath(input.exePath) };
}
