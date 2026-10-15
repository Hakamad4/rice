/**
 * Perfil da máquina para o Windows "otimizado". NÃO decide nada sozinho: usa o `planTranscriber()` (src/main/asr/transcriber-plan.ts), o único
 * caminho que escolhe o modelo do Whisper e as threads (limites medidos: ≤ 8 GiB de RAM ou < 6 núcleos → small q5_1; ≤ 4 GiB ou < 4 núcleos →
 * base q5_1; senão o grande). Aqui só se traduz o plano para a tela ("Em uso: modelo leve (small; 8 GB de RAM, 4 núcleos)") e para o modo leve da
 * IA ao vivo (ideias e war room mais contidos). `settings.asrModel`: 'auto' | 'light' | 'full'. No Mac o modo é ignorado (sempre o modelo grande).
 */
import { planTranscriber, normalizeMode, type TranscriberMode, type TranscriberTier } from '../asr/transcriber-plan';

export type AsrChoice = TranscriberMode;

export type MachineProfile = {
  /** Modelo em uso: o que a tela mostra. */
  model: 'light' | 'full';
  tier: TranscriberTier;
  /** Nome do arquivo do modelo e threads, como o plano as escolheu. */
  modelName: string;
  threads: number;
  ramGb: number;
  cores: number;
  /** Por que: memória/núcleos baixos (auto), forçado a leve, forçado a completo, máquina com folga (auto), Mac, ou RICE_WHISPER_MODEL à mão. */
  reason: 'low-ram' | 'forced-light' | 'forced-full' | 'enough-ram' | 'mac' | 'override';
  /** O modo leve restringe a IA ao vivo (padrões mais contidos). */
  light: boolean;
};

export const asrChoiceOf = (v: unknown): AsrChoice => normalizeMode(v);

export function machineProfile(input: { platform: string; totalMemBytes: number; logicalCores: number; choice?: unknown; variantOverride?: string }): MachineProfile {
  const windows = input.platform === 'win32';
  const mode = asrChoiceOf(input.choice);
  const plan = planTranscriber(mode, { totalMemBytes: input.totalMemBytes, logicalCores: input.logicalCores }, windows, input.variantOverride);
  const reason: MachineProfile['reason'] = !windows ? 'mac' : input.variantOverride ? 'override' : mode === 'full' ? 'forced-full' : mode === 'light' ? 'forced-light' : plan.tier === 'large' ? 'enough-ram' : 'low-ram';
  return { model: plan.tier === 'large' ? 'full' : 'light', tier: plan.tier, modelName: plan.model.name, threads: plan.threads, ramGb: Math.round(input.totalMemBytes / 1024 ** 3), cores: input.logicalCores, reason, light: plan.tier !== 'large' };
}

/** Multiplicador dos intervalos da IA ao vivo (ciclos de ideias/war room e capturas por fala) em modo leve. */
export const lightFactor = (profile: Pick<MachineProfile, 'light'>): number => (profile.light ? 2 : 1);
