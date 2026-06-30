import type { AccountBillingSnapshot, AccountView } from '@team-manager/shared';
import { JSON_MIME_TYPE, safeFileSegment, type FileDownload } from '../../components/fileDownload.js';

function fileTimestamp(refreshedAt: number): string {
  return new Date(refreshedAt).toISOString().replace(/[:.]/g, '-');
}

export function buildBillingSnapshotDownload(
  account: AccountView,
  snapshot: AccountBillingSnapshot
): FileDownload {
  const accountLabel = account.remark || account.email || snapshot.accountId;
  const fileName = `${safeFileSegment(accountLabel, 'account')}-${safeFileSegment(
    snapshot.workspaceAccountId,
    'workspace'
  )}-billing-${fileTimestamp(snapshot.refreshedAt)}.json`;

  return {
    fileName,
    content: `${JSON.stringify(snapshot.raw, null, 2)}\n`,
    mimeType: JSON_MIME_TYPE
  };
}
