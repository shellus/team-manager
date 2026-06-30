export interface FileDownload {
  fileName: string;
  content: string;
  mimeType: string;
}

export const JSON_MIME_TYPE = 'application/json;charset=utf-8';

export function safeFileSegment(value: string, fallback = 'credential'): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment || fallback;
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
