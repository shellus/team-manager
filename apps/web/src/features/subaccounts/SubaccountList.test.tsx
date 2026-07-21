import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { subaccountSummaryFromView, type SubaccountSummaryView, type SubaccountView } from '@team-manager/shared';
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

function renderList(subaccount: SubaccountView) {
  const summary: SubaccountSummaryView = subaccountSummaryFromView(subaccount);
  return renderToStaticMarkup(
    <SubaccountList
      subaccounts={[summary]}
      registrationJobs={[]}
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
});
