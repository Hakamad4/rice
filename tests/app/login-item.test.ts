import { describe, expect, it } from 'vitest';
import { LOGIN_ARG, loginItemApplicable, loginItemOptions, startedAtLogin } from '../../src/main/app/login-item';

describe('Iniciar com o Windows', () => {
  it('ligado: abre ao entrar e com o argumento que diz "só bandeja"; desligado: não abre e sem argumentos', () => {
    expect(loginItemOptions(true)).toEqual({ openAtLogin: true, args: [LOGIN_ARG] });
    expect(loginItemOptions(false)).toEqual({ openAtLogin: false, args: [] });
  });

  it('reconhece a abertura pelo Windows (e não pelo usuário)', () => {
    expect(startedAtLogin(['C:\\Users\\José da Silva\\AppData\\Local\\Programs\\Rice\\Rice.exe', LOGIN_ARG])).toBe(true);
    expect(startedAtLogin(['C:\\Users\\José da Silva\\AppData\\Local\\Programs\\Rice\\Rice.exe'])).toBe(false);
  });

  it('só no Windows e nunca em instância de teste (não mexe no login de verdade do sistema)', () => {
    expect(loginItemApplicable('win32', false)).toBe(true);
    expect(loginItemApplicable('win32', true)).toBe(false);
    expect(loginItemApplicable('darwin', false)).toBe(false);
  });
});
