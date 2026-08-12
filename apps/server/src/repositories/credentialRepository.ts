import type { Kysely } from 'kysely';
import { ArtifactStore } from '../artifactStore.js';
import type { Database, WorkspaceCredentialRow } from '../database/schema.js';

export interface SaveCredentialInput {
  accountId: string;
  workspaceId: string;
  kind: 'oauth' | 'pat';
  fileName: string;
  content: Uint8Array;
  externalId?: string | null;
  poolGroupId?: string | null;
  eligibilitySource?: 'membership' | 'invitation' | 'migration';
  status?: 'active' | 'disabled' | 'revoked' | 'unknown';
}

export class CredentialRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly artifacts: ArtifactStore
  ) {}

  async save(input: SaveCredentialInput): Promise<WorkspaceCredentialRow> {
    const eligibilitySource = input.eligibilitySource ?? await this.resolveEligibility(input.accountId, input.workspaceId);
    const artifact = await this.artifacts.writeImmutable('credentials', input.fileName, input.content);
    return this.db.insertInto('workspace_credentials').values({
      account_id: input.accountId,
      workspace_id: input.workspaceId,
      pool_group_id: input.poolGroupId ?? null,
      kind: input.kind,
      external_id: input.externalId ?? null,
      storage_key: artifact.storageKey,
      content_sha256: artifact.contentSha256,
      byte_size: artifact.byteSize,
      format_version: 1,
      eligibility_source: eligibilitySource,
      status: input.status ?? 'active'
    }).onConflict((oc) => oc.column('content_sha256').doUpdateSet({
      account_id: input.accountId,
      workspace_id: input.workspaceId,
      pool_group_id: input.poolGroupId ?? null,
      status: input.status ?? 'active'
    })).returningAll().executeTakeFirstOrThrow();
  }

  async read(id: string): Promise<Buffer> {
    const row = await this.db.selectFrom('workspace_credentials').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new Error('Workspace 凭证不存在');
    return this.artifacts.read(row.storage_key, row.content_sha256);
  }

  async ensurePoolGroup(nameInput: string): Promise<string> {
    const name = nameInput.trim() || '默认号池';
    const normalizedName = name.toLowerCase();
    const existing = await this.db.selectFrom('credential_pool_groups').select('id').where('normalized_name', '=', normalizedName).executeTakeFirst();
    if (existing) return existing.id;
    return this.db.insertInto('credential_pool_groups').values({ name, normalized_name: normalizedName }).returning('id').executeTakeFirstOrThrow().then((row) => row.id);
  }

  private async resolveEligibility(accountId: string, workspaceId: string): Promise<'membership' | 'invitation'> {
    const membership = await this.db.selectFrom('workspace_memberships').select('id')
      .where('account_id', '=', accountId).where('workspace_id', '=', workspaceId).where('status', '=', 'active').executeTakeFirst();
    if (membership) return 'membership';
    const account = await this.db.selectFrom('accounts').select('normalized_email').where('id', '=', accountId).executeTakeFirstOrThrow();
    const invitation = await this.db.selectFrom('workspace_invitations').select('id')
      .where('workspace_id', '=', workspaceId).where('normalized_email', '=', account.normalized_email).where('status', '=', 'pending').executeTakeFirst();
    if (invitation) return 'invitation';
    throw new Error('账号与 Workspace 之间没有活动成员关系或待接受邀请，不能保存凭证');
  }
}
