import { isWindows } from './index';

/** Painéis do sistema que os avisos sabem abrir (URLs fixas; o renderer nunca escolhe). Windows: `ms-settings:`. */
export type SystemPanel = 'storage' | 'microphone' | 'audioCapture';

const MAC: Record<SystemPanel, string> = {
  storage: 'x-apple.systempreferences:com.apple.settings.Storage',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  audioCapture: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
};
const WIN: Record<SystemPanel, string> = {
  storage: 'ms-settings:storagesense',
  microphone: 'ms-settings:privacy-microphone',
  audioCapture: 'ms-settings:privacy-microphone', // o áudio do sistema (loopback do WASAPI) não tem permissão própria no Windows
};

export const systemPanelUrl = (panel: SystemPanel): string => (isWindows() ? WIN : MAC)[panel];

/** Cores da barra de título do Windows (os botões nativos desenhados sobre a nossa faixa de 48px CSS). */
/** Cor da faixa dos botões do Windows = `--bg` de design/tokens.css (claro #fcfcfb, escuro #191919); tests/design/tokens.test.ts confere. */
export function titleBarOverlay(dark: boolean, zoom = 1): { color: string; symbolColor: string; height: number } {
  return { color: dark ? '#191919' : '#fcfcfb', symbolColor: dark ? '#ffffff' : '#1d1d1f', height: Math.max(24, Math.round(48 * zoom)) };
}
