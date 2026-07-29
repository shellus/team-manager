import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { SubaccountView } from '@team-manager/shared';
import { SubaccountDetail } from './SubaccountDetail.js';

const subaccount: SubaccountView = {
  id: 'subaccount-1',
  email: 'child@example.com',
  managedAccountEmail: 'child@example.com',
  groupName: '默认分组',
  status: 'session_ready',
  hasWebSession: true,
  codexCredentials: [],
  teamLinks: [],
  createdAt: 1,
  updatedAt: 2
};

describe('SubaccountDetail', () => {
  test('keeps Pro 5x enabled from the local GAM association without loading live status', () => {
    const html = renderToStaticMarkup(
      <SubaccountDetail
        subaccount={subaccount}
        accounts={[]}
        loading={false}
        activeTab="account-manager"
        logs={[]}
        logsLoaded={false}
        busyState={{}}
        accountManagerStatus={null}
        accountManagerLoading={false}
        pro5xSubscription={null}
        pro5xSubscriptionLoading={false}
        quota={null}
        syncing={false}
        onTabChange={() => undefined}
        onSubaccountChanged={() => undefined}
        onOpenEdit={() => undefined}
        onOpenDelete={() => undefined}
        onOpenPro5x={() => undefined}
        onRetryPro5x={() => undefined}
        onRotatePro5x={() => undefined}
        onTerminatePro5x={() => undefined}
        onDismissPro5x={() => undefined}
        onCancelPro5xRenewal={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onStartOauth={() => undefined}
        onCreatePat={() => undefined}
        onRefreshQuota={() => undefined}
        onExportPat={() => undefined}
        onOpenDeletePat={() => undefined}
      />
    );

    const button = html.match(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*开通 Pro 5x(?:(?!<\/button>)[\s\S])*<\/button>/
    )?.[0] ?? '';
    expect(button).toContain('开通 Pro 5x');
    expect(button).not.toContain('disabled');
  });


  test('shows the successful Pro 5x payment card tail in the opened button', () => {
    const html = renderToStaticMarkup(
      <SubaccountDetail
        subaccount={{
          ...subaccount,
          accountManagerHasPro5x: true,
          accountManagerPro5xCardLast4: '4242'
        }}
        accounts={[]}
        loading={false}
        activeTab="account-manager"
        logs={[]}
        logsLoaded={false}
        busyState={{}}
        accountManagerStatus={null}
        accountManagerLoading={false}
        pro5xSubscription={null}
        pro5xSubscriptionLoading={false}
        quota={null}
        syncing={false}
        onTabChange={() => undefined}
        onSubaccountChanged={() => undefined}
        onOpenEdit={() => undefined}
        onOpenDelete={() => undefined}
        onOpenPro5x={() => undefined}
        onRetryPro5x={() => undefined}
        onRotatePro5x={() => undefined}
        onTerminatePro5x={() => undefined}
        onDismissPro5x={() => undefined}
        onCancelPro5xRenewal={() => undefined}
        onSync={() => undefined}
        onOpenInvite={() => undefined}
        onStartOauth={() => undefined}
        onCreatePat={() => undefined}
        onRefreshQuota={() => undefined}
        onExportPat={() => undefined}
        onOpenDeletePat={() => undefined}
      />
    );

    expect(html).toContain('已开 Pro 5x · 4242');
  });
});
