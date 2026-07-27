import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  type AccountManagerProfileView,
  subaccountSummaryFromView,
  type SubaccountRegistrationJobView,
  type SubaccountSummaryView,
  type SubaccountView
} from '@team-manager/shared';
import { SubaccountList } from './SubaccountList.js';

const baseSubaccount: SubaccountView = {
  id: 'subaccount-1',
  email: 'child@example.com',
  groupName: '默认分组',
  status: 'session_ready',
  hasWebSession: true,
  codexCredentials: [],
  teamLinks: [],
  createdAt: 1,
  updatedAt: 2
};

function renderList(
  subaccount: SubaccountView,
  registrationJobs: SubaccountRegistrationJobView[] = [],
  accountProfileStatuses: Record<string, AccountManagerProfileView> = {}
) {
  const summary: SubaccountSummaryView = subaccountSummaryFromView(subaccount);
  return renderToStaticMarkup(
    <SubaccountList
      subaccounts={[summary]}
      registrationJobs={registrationJobs}
      accountProfileStatuses={accountProfileStatuses}
      groups={[]}
      activeGroup=""
      searchQuery=""
      selectedId={summary.id}
      runtimeStatus={{ configured: true, reachable: true }}
      isBusy={() => false}
      onSelect={() => undefined}
      onGroupChange={() => undefined}
      onSearchChange={() => undefined}
      onOpenImportSession={() => undefined}
      onOpenRegister={() => undefined}
      onRetryRegistration={() => undefined}
      onSelectRegistration={() => undefined}
      onOpenEdit={() => undefined}
      onOpenDelete={() => undefined}
    />
  );
}

describe('SubaccountList', () => {
  test('marks a managed child account with the GAM label', () => {
    const html = renderList({
      ...baseSubaccount,
      managedAccountEmail: baseSubaccount.email
    });

    expect(html).toContain('GAM');
    expect(html).toContain('record-status-meta');
    expect(html).not.toContain('record-capability-tags');
  });

  test('marks an independently imported child account as non-GAM', () => {
    expect(renderList(baseSubaccount)).toContain('非 GAM');
  });

  test('marks a manually banned child account', () => {
    expect(renderList({ ...baseSubaccount, isBanned: true })).toContain('已封号');
  });

  test('marks a child whose manual Profile is running', () => {
    const html = renderList({
      ...baseSubaccount,
      managedAccountEmail: baseSubaccount.email
    }, [], {
      [baseSubaccount.id]: {
        accountId: baseSubaccount.email,
        status: 'running',
        profileId: 'runtime-profile',
        updatedAt: 1
      }
    });

    expect(html).toContain('Profile 已启动');
  });

  test('keeps proxy configuration out of the child registration status card', () => {
    const html = renderList(baseSubaccount, [{
      id: 'registration-1',
      status: 'waiting_manual',
      phase: 'registration_stage_waiting_manual',
      message: '页面提交后暂未推进',
      progress: 95,
      createdAt: 1,
      updatedAt: 2
    }]);

    expect(html).toContain('等待人工处理');
    expect(html).not.toContain('更换IP');
  });
});
