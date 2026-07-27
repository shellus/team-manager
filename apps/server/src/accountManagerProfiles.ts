import type { AccountManagerProfileView } from '@team-manager/shared';
import type { AccountManagerGateway } from './accountManagerClient.js';

type ManagedLocalRecord = {
  id: string;
  managedAccountEmail?: string;
};

export async function accountManagerProfilesByLocalId(
  accountManager: AccountManagerGateway | undefined,
  records: readonly ManagedLocalRecord[]
): Promise<Record<string, AccountManagerProfileView>> {
  if (!accountManager) return {};
  const linkedRecords = records.flatMap((record) => {
    const email = record.managedAccountEmail?.trim().toLowerCase();
    return email ? [{ id: record.id, email }] : [];
  });
  if (linkedRecords.length === 0) return {};

  const profiles = accountManager.listAccountProfiles
    ? Object.values(await accountManager.listAccountProfiles())
    : await Promise.all(
      [...new Set(linkedRecords.map((record) => record.email))]
        .map((email) => accountManager.accountProfile(email))
    );
  const profilesByEmail = new Map(
    profiles.map((profile) => [profile.accountId.trim().toLowerCase(), profile])
  );
  return Object.fromEntries(linkedRecords.flatMap((record) => {
    const profile = profilesByEmail.get(record.email);
    return profile ? [[record.id, profile] as const] : [];
  }));
}
