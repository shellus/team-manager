import type { SubaccountRegistrationJobStatus } from '@team-manager/shared';

export function parentRegistrationStageNeedsPolling(stage: string): boolean {
  return stage === 'registering' || stage === 'waiting_manual';
}

export function registrationStatusNeedsPolling(status: SubaccountRegistrationJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_manual';
}
