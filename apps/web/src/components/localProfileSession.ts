import type { ChatGptSessionInput } from '@team-manager/shared';

export function formatLocalProfileSessionJson(session?: ChatGptSessionInput): string {
  return session ? JSON.stringify(session, null, 2) : '';
}

export function shouldSubmitLocalProfileSession(current: string | undefined, initial: string): boolean {
  const next = current?.trim() ?? '';
  if (!next) return false;
  return next !== initial.trim();
}
