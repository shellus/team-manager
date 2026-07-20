import type { SubaccountRegistrationJobView, SubaccountView } from '@team-manager/shared';
import { describe, expect, it } from 'vitest';
import { registrationJobMatchesQuery, subaccountMatchesQuery } from './subaccountSearch.js';

const subaccount = {
  id: 'child-a',
  email: 'child@example.com',
  remark: '客户测试号',
  groupName: '客户 A',
  managedAccountEmail: 'child@example.com',
  status: 'session_ready',
  hasWebSession: true,
  codexCredentials: [],
  teamLinks: [],
  createdAt: 1,
  updatedAt: 2
} satisfies SubaccountView;

const job = {
  id: 'job-a',
  status: 'running',
  phase: 'chatgpt_signup',
  message: '正在注册 ChatGPT 账号',
  progress: 42,
  email: 'pending@example.com',
  createdAt: 1,
  updatedAt: 2
} satisfies SubaccountRegistrationJobView;

describe('subaccount search', () => {
  it('matches child email, remark, group and Account Manager reference using combined terms', () => {
    expect(subaccountMatchesQuery(subaccount, '客户 A')).toBe(true);
    expect(subaccountMatchesQuery(subaccount, 'child example')).toBe(true);
    expect(subaccountMatchesQuery(subaccount, '不存在')).toBe(false);
  });

  it('keeps active registration jobs searchable', () => {
    expect(registrationJobMatchesQuery(job, 'pending 注册')).toBe(true);
    expect(registrationJobMatchesQuery(job, 'failed')).toBe(false);
  });
});
