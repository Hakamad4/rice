import { t } from '../i18n';
import { aiError } from './errors';
import { ClaudeError, ClaudeRunner, type ClaudeRunnerConfig } from '../claude/runner';
import { AiError, type AiRunner } from './types';

/** `claude -p` (assinatura ou login do CLI), com os erros do `ClaudeRunner` traduzidos para `AiError`. */
export function createClaudeSubRunner(config: ClaudeRunnerConfig): AiRunner {
  const runner = new ClaudeRunner(config);
  return {
    async *run(options) {
      try {
        return yield* runner.run(options);
      } catch (err) {
        if (err instanceof ClaudeError) {
          switch (err.kind) {
            case 'cancelled':
              throw new AiError('cancelled', t('ai.err.cancelled'));
            case 'not-installed':
              throw new AiError('not-installed', t('ai.cli.claude-missing'));
            case 'not-logged-in':
              throw new AiError('auth', t('ai.cli.claude-auth'));
            case 'rate-limited':
              throw aiError('claude-sub', 'rate-limit');
            default:
              throw aiError('claude-sub', 'other', err.message, [await config.getToken?.()]);
          }
        }
        throw err;
      }
    },
  };
}
