import type { CodexCredentialJson, SubaccountView } from '@team-manager/shared';

export interface FileDownload {
  fileName: string;
  content: string;
  mimeType: string;
}

const JSON_MIME_TYPE = 'application/json;charset=utf-8';

function safeFileSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment || 'credential';
}

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

export function downloadTextFile(download: FileDownload): void {
  const blob = new Blob([download.content], { type: download.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = download.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
