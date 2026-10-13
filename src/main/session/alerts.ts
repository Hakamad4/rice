import { EventEmitter } from 'node:events';

/** O que o botão do aviso faz; quem executa é o main (abre um painel do sistema ou age na sessão). */
export type AlertActionKind = 'open-storage' | 'open-mic-privacy' | 'open-audio-privacy' | 'keep-recording' | 'stop-recording' | 'resume-recording' | 'generate-notes' | 'recover-meeting' | 'unpause-recording';

export type Alert = {
  /** Estável por causa (ex.: `storage`, `source:sys`): atualizar o mesmo id troca o aviso, `clear` o remove. */
  id: string;
  level: 'info' | 'warn' | 'error';
  /** Já traduzido. */
  message: string;
  action?: { kind: AlertActionKind; label: string };
  /** Segundo botão (ex.: "Parar agora" ao lado de "Manter gravando"). */
  secondary?: { kind: AlertActionKind; label: string };
  /** Dá para fechar (avisos que ficam depois da gravação, como "o áudio ficou em tal pasta"). */
  dismissible?: boolean;
  /** Reunião a que o aviso se refere (ações como "gerar notas"). */
  dir?: string;
};

/**
 * Avisos persistentes (banner no app): ficam até a causa sumir. Nada de degradação silenciosa: toda falha que afeta
 * a gravação vira um aviso com id próprio e é removido quando a situação volta ao normal.
 */
export class AlertCenter extends EventEmitter {
  private readonly alerts = new Map<string, Alert>();

  set(alert: Alert): void {
    const previous = this.alerts.get(alert.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(alert)) return;
    this.alerts.set(alert.id, alert);
    this.emit('change', this.list());
  }

  clear(id: string): void {
    if (this.alerts.delete(id)) this.emit('change', this.list());
  }

  /** Remove todos os avisos cujo id começa com `prefix` (fim de gravação, por exemplo). */
  clearPrefix(prefix: string): void {
    let changed = false;
    for (const id of [...this.alerts.keys()]) if (id.startsWith(prefix)) changed = this.alerts.delete(id) || changed;
    if (changed) this.emit('change', this.list());
  }

  has(id: string): boolean {
    return this.alerts.has(id);
  }

  list(): Alert[] {
    return [...this.alerts.values()];
  }
}
