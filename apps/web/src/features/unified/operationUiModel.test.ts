import { describe, expect, it } from 'vitest';
import type { AccountManagerOperationView } from '@team-manager/shared';
import { operationDrawerActions, operationPhaseLabel, operationTypeLabel } from './operationUiModel.js';

const operation = (patch: Partial<AccountManagerOperationView> = {}): AccountManagerOperationView => ({
  id: 'op', type: 'register_account', status: 'running', phase: 'running', progress: 50,
  createdAt: 1, updatedAt: 1, ...patch,
});

describe('operation drawer model', () => {
  it('仅给活动注册任务显示终止和代理编辑', () => {
    expect(operationDrawerActions(operation())).toEqual({
      retry: false, rotateIp: false, terminate: true, supplyCard: false,
      editRegistrationProxy: true, remove: false,
    });
  });

  it('仅在付款操作明确缺卡时显示补卡', () => {
    expect(operationDrawerActions(operation({
      type: 'change_personal_subscription', status: 'waiting_manual', phase: 'payment_card_required',
    })).supplyCard).toBe(true);
    expect(operationDrawerActions(operation({ status: 'succeeded' })).remove).toBe(true);
  });

  it('取消续费、纳管和已中断操作不提供浏览器恢复动作', () => {
    for (const type of ['cancel_personal_subscription_renewal', 'import_account']) {
      expect(operationDrawerActions(operation({ type, status: 'failed' })).rotateIp).toBe(false);
      expect(operationDrawerActions(operation({ type, status: 'failed' })).retry).toBe(false);
    }
    expect(operationDrawerActions(operation({ status: 'interrupted' })).retry).toBe(false);
  });

  it('将操作类型和阶段翻译为业务文案', () => {
    expect(operationTypeLabel('import_account')).toBe('纳入 GAM');
    expect(operationPhaseLabel('waiting_for_otp')).toBe('等待验证码');
  });
});
