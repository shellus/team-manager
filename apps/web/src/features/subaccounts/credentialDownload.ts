import type { CodexCredentialJson, SubaccountView } from '@team-manager/shared';
import { JSON_MIME_TYPE, safeFileSegment, type FileDownload } from '../../components/fileDownload.js';
export { downloadTextFile } from '../../components/fileDownload.js';

export function buildCredentialDownload(
  subaccount: SubaccountView,
  workspaceId: string,
  credential: CodexCredentialJson
): FileDownload {
  const existing = subaccount.codexCredentials.find((item) => item.accountId === workspaceId);
  const fileName =
    existing?.fileName ||
    `${safeFileSegment(credential.email || subaccount.email)}-${safeFileSegment(workspaceId || credential.account_id)}.json`;

  return {
    fileName,
    content: `${JSON.stringify(credential, null, 2)}\n`,
    mimeType: JSON_MIME_TYPE
  };
}

export function buildWorkspaceSessionDownload(
  subaccount: SubaccountView,
  workspaceId: string,
  session: Record<string, unknown>
): FileDownload {
  return {
    fileName: `${safeFileSegment(subaccount.email)}-${safeFileSegment(workspaceId)}-session.json`,
    content: `${JSON.stringify(session, null, 2)}\n`,
    mimeType: JSON_MIME_TYPE
  };
}
