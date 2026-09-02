export const SCOLIA_COMMAND_ACK_TIMEOUT_MS = 10_000;
export const SCOLIA_COMMAND_MAX_ATTEMPTS = 3;

export type StaleScoliaCommandAction = 'retry' | 'fail';

export function staleCommandCutoff(now = Date.now()): string {
  return new Date(now - SCOLIA_COMMAND_ACK_TIMEOUT_MS).toISOString();
}

export function staleCommandAction(attempts: number): StaleScoliaCommandAction {
  return attempts >= SCOLIA_COMMAND_MAX_ATTEMPTS ? 'fail' : 'retry';
}
