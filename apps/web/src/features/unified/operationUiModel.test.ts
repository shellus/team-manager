import { describe, expect, it } from 'vitest';
import type { AutomationOperationView } from '@team-manager/shared';
import { operationDrawerActions, operationPhaseLabel, operationTypeLabel } from './operationUiModel.js';

const operation = (patch: Partial<AutomationOperationView> = {}): AutomationOperationView => ({
  id: 'op', type: 'change_personal_subscription', status: 'running', phase: 'running', progress: 50,
  createdAt: 1, updatedAt: 1, ...patch,
});

describe('operation drawer model', () => {
  it('只允许清理已结束的本地操作记录', () => {
    expect(operationDrawerActions(operation())).toEqual({ remove: false });
    expect(operationDrawerActions(operation({ status: 'succeeded' }))).toEqual({ remove: true });
    expect(operationDrawerActions(operation({ status: 'failed' }))).toEqual({ remove: true });
  });

  it('将操作类型和阶段翻译为业务文案', () => {
    expect(operationTypeLabel('change_personal_subscription')).toBe('个人套餐');
    expect(operationPhaseLabel('personal_subscription_upgrade_verified')).toBe('升级已生效');
    expect(operationTypeLabel('import_account')).toBe('import account');
  });
});
