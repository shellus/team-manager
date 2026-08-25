import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import type { SeatOperationalOverviewView } from '@team-manager/shared';
import { renewalStatusMeta, SeatCard, seatSubjectMeta } from './OverviewPage.js';

describe('母号概览状态', () => {
  test('临近日期统一显示三天内到期', () => {
    expect(renewalStatusMeta.expiring_soon.label).toBe('三天内到期');
  });

  test('当期发票未支付时显示待支付', () => {
    expect(renewalStatusMeta.payment_due.label).toBe('待支付');
  });
});

describe('席位概览对象', () => {
  test('使用成员、邀请、空位和租客资料等用户术语', () => {
    expect(seatSubjectMeta.member.label).toBe('成员');
    expect(seatSubjectMeta.invitation.label).toBe('邀请中');
    expect(seatSubjectMeta.vacancy.label).toBe('空位');
    expect(seatSubjectMeta.customer.label).toBe('租客资料');
  });

  test('无租客资料的固定成员仍展示为成员', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SeatCard, { item: seat({
      id: 'member:brad', subject: 'member', email: 'brad@example.com', relationStatus: 'member',
      role: 'analytics_viewer', hasCustomerProfile: false,
    }) })));
    expect(html).toContain('brad@example.com');
    expect(html).toContain('成员');
    expect(html).toContain('未录入租客资料');
    expect(html).not.toContain('释放');
  });

  test('固定容量余量展示为空位而不是租客资料', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SeatCard, { item: seat({
      id: 'vacancy:workspace:1', subject: 'vacancy', relationStatus: 'unclaimed', hasCustomerProfile: false,
    }) })));
    expect(html).toContain('空位');
    expect(html).toContain('可分配固定 ChatGPT 成员');
    expect(html).not.toContain('未录入租客资料');
  });
});

function seat(input: Partial<SeatOperationalOverviewView> & Pick<SeatOperationalOverviewView, 'id' | 'subject' | 'relationStatus' | 'hasCustomerProfile'>): SeatOperationalOverviewView {
  return {
    workspaceId: 'workspace-id', workspaceExternalId: 'workspace-external', workspaceName: 'Workspace',
    seatType: 'default', expirationStatus:'not_set', managingAccounts: [], riskLevel: 'normal', risks: [], ...input,
  };
}
