import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { SecretCipher, sha256, type EncryptedValue } from '../secretCipher.js';

export type AccessContext =
  | { kind: 'personal'; personalSpaceId: string }
  | { kind: 'workspace'; workspaceId: string };

export interface SaveSessionRevisionInput {
  accountId: string;
  session: unknown;
  source: string;
  sourceUpdatedAt?: Date | string | null;
  observedEmail?: string | null;
  observedPersonalAccountId?: string | null;
  makeCurrent?: boolean;
}

export class SessionRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly cipher: SecretCipher
  ) {}

  async saveRevision(input: SaveSessionRevisionInput): Promise<string> {
    const plaintext = stableJson(input.session);
    const digest = sha256(plaintext);
    const execute = async (trx: Kysely<Database>) => {
      const existing = await trx.selectFrom('account_session_revisions')
        .select('id').where('account_id', '=', input.accountId).where('plaintext_sha256', '=', digest).executeTakeFirst();
      const id = existing?.id ?? await this.insertRevision(trx as Kysely<Database>, input, plaintext, digest);
      if (input.makeCurrent !== false) {
        await trx.updateTable('accounts').set({ current_session_revision_id: id }).where('id', '=', input.accountId).executeTakeFirstOrThrow();
      }
      return id;
    };
    return this.db.isTransaction ? execute(this.db) : this.db.transaction().execute(execute);
  }

  async currentSession(accountId: string): Promise<unknown | undefined> {
    const row = await this.db.selectFrom('accounts as a')
      .innerJoin('account_session_revisions as r', 'r.id', 'a.current_session_revision_id')
      .select(['r.ciphertext', 'r.nonce', 'r.auth_tag', 'r.key_version'])
      .where('a.id', '=', accountId).executeTakeFirst();
    if (!row) return undefined;
    return JSON.parse(this.cipher.decrypt(toEncrypted(row), `account-session:${accountId}`));
  }

  async saveAccessToken(accountId: string, context: AccessContext, accessToken: string, input: {
    expiresAt?: Date | string | null;
    checkedAt?: Date | string | null;
    status?: 'unknown' | 'valid' | 'invalid';
  } = {}): Promise<void> {
    const contextKey = context.kind === 'personal' ? `personal:${context.personalSpaceId}` : `workspace:${context.workspaceId}`;
    const encrypted = this.cipher.encrypt(accessToken, `access-context:${accountId}:${contextKey}`);
    const values = {
      account_id: accountId,
      personal_space_id: context.kind === 'personal' ? context.personalSpaceId : null,
      workspace_id: context.kind === 'workspace' ? context.workspaceId : null,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      expires_at: input.expiresAt ?? null,
      checked_at: input.checkedAt ?? null,
      status: input.status ?? 'unknown'
    };
    await this.db.insertInto('account_access_contexts').values(values)
      .onConflict((oc) => oc.columns(['account_id', 'personal_space_id', 'workspace_id']).doUpdateSet(values)).execute();
  }

  async accessToken(accountId: string, context: AccessContext): Promise<string | undefined> {
    let query = this.db.selectFrom('account_access_contexts').selectAll().where('account_id', '=', accountId);
    query = context.kind === 'personal'
      ? query.where('personal_space_id', '=', context.personalSpaceId).where('workspace_id', 'is', null)
      : query.where('workspace_id', '=', context.workspaceId).where('personal_space_id', 'is', null);
    const row = await query.executeTakeFirst();
    if (!row || row.status === 'invalid' || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return undefined;
    const contextKey = context.kind === 'personal' ? `personal:${context.personalSpaceId}` : `workspace:${context.workspaceId}`;
    return this.cipher.decrypt(toEncrypted(row), `access-context:${accountId}:${contextKey}`);
  }

  async invalidateWorkspaceAccessTokens(accountId: string): Promise<number> {
    const result = await this.db.updateTable('account_access_contexts').set({
      status: 'invalid',
      checked_at: new Date()
    }).where('account_id', '=', accountId).where('workspace_id', 'is not', null).executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async invalidateAccessTokens(accountId: string): Promise<number> {
    const result = await this.db.updateTable('account_access_contexts').set({
      status: 'invalid',
      checked_at: new Date()
    }).where('account_id', '=', accountId).executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  private async insertRevision(db: Kysely<Database>, input: SaveSessionRevisionInput, plaintext: string, digest: string): Promise<string> {
    const encrypted = this.cipher.encrypt(plaintext, `account-session:${input.accountId}`);
    const row = await db.insertInto('account_session_revisions').values({
      account_id: input.accountId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      plaintext_sha256: digest,
      source: input.source,
      source_updated_at: input.sourceUpdatedAt ?? null,
      observed_email: input.observedEmail ?? null,
      observed_personal_account_id: input.observedPersonalAccountId ?? null
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function toEncrypted(row: { ciphertext: string; nonce: string; auth_tag: string; key_version: string }): EncryptedValue {
  return { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag, keyVersion: row.key_version };
}
