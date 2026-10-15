/** "Iniciar com o Windows": o Rice abre ao entrar no Windows, só na bandeja (sem janela), e a opção vem DESLIGADA. */
export const LOGIN_ARG = '--rice-login';

/** Opções para `app.setLoginItemSettings` (no Windows grava na chave Run do usuário, sem administrador). */
export function loginItemOptions(on: boolean): { openAtLogin: boolean; args: string[] } {
  return { openAtLogin: on, args: on ? [LOGIN_ARG] : [] };
}

/** O app foi aberto pelo Windows ao entrar (e não pelo usuário): fica só na bandeja. */
export const startedAtLogin = (argv: readonly string[]): boolean => argv.includes(LOGIN_ARG);

/** Só o Windows tem essa opção na tela; instâncias de teste nunca mexem no login do sistema. */
export const loginItemApplicable = (platform: string, testInstance: boolean): boolean => platform === 'win32' && !testInstance;
