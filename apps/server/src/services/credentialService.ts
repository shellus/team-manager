import type { Kysely } from 'kysely';
import type { CodexCredentialJson } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { ArtifactStore } from '../artifactStore.js';
import { fetchCodexQuota } from '../codexQuota.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { CredentialRepository } from '../repositories/credentialRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import type { Transport } from '../transport.js';
import { ChatGptApi } from '../chatgptApi.js';
import { fetchWorkspaceWebAccessTokenFromSessionToken } from '../chatgptWebSession.js';

const CODEX_PAT_TTL_SECONDS = 30 * 24 * 60 * 60;
const CODEX_LOCAL_ACCESS_SCOPE = 'chatgpt.workspace.feature.allow-codex-local-access.access';

export class CredentialService {
  readonly #credentials: CredentialRepository;
  readonly #workspaces: WorkspaceRepository;
  constructor(
    private readonly db: Kysely<Database>,
    artifacts: ArtifactStore,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository,
    private readonly transport: Transport
  ) {
    this.#credentials = new CredentialRepository(db, artifacts);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async createPat(accountId: string, workspaceId: string, input: { name?: string; ttl?: number; poolGroup?: string }) {
    try {
      const { api, account, workspace } = await this.context(accountId, workspaceId);
      const token = await api.createCodexPersonalAccessToken({
        name: input.name?.trim() || `team-manager-${new Date().toISOString().slice(0, 10)}`,
        scopes: [CODEX_LOCAL_ACCESS_SCOPE],
        ttl: Number.isFinite(input.ttl) && Number(input.ttl) > 0 ? Number(input.ttl) : CODEX_PAT_TTL_SECONDS
      });
      if (!token.access_token) throw new ServiceError(502, '上游 PAT 响应缺少 access_token');
      if (!token.workspace_id) throw new ServiceError(502, '上游 PAT 响应缺少 workspace_id');
      if (token.workspace_id !== workspace.external_id) throw new ServiceError(409, '上游 PAT Workspace 与目标不一致');
      if (!token.expires_at) throw new ServiceError(502, '上游 PAT 响应缺少 expires_at');
      const poolGroupId = input.poolGroup?.trim() ? await this.#credentials.ensurePoolGroup(input.poolGroup) : null;
      const credential: CodexCredentialJson = {
        access_token: token.access_token,
        personal_access_token: token.access_token,
        account_id: workspace.external_id,
        email: token.creator_user_email?.trim() || account.email,
        type: 'codex',
        auth_mode: 'personalAccessToken',
        credential_source: 'personal_access_token',
        credential_id: token.credential_id,
        chatgpt_user_id: token.owner_user_id,
        last_refresh: token.created_at ? new Date(token.created_at * 1000).toISOString() : new Date().toISOString(),
        expired: new Date(token.expires_at * 1000).toISOString()
      };
      const row = await this.#credentials.save({
        accountId,
        workspaceId,
        kind: 'pat',
        fileName: `${account.email}-${workspace.external_id}.json`,
        content: Buffer.from(JSON.stringify(credential)),
        externalId: token.credential_id ?? null,
        poolGroupId
      });
      return { id: row.id };
    } catch (error) { throw asServiceError(error); }
  }

  async refreshQuota(credentialId: string) {
    try {
      const row = await this.db.selectFrom('workspace_credentials').selectAll().where('id', '=', credentialId).executeTakeFirst();
      if (!row) throw new ServiceError(404, 'Workspace 凭证不存在');
      const credential = JSON.parse((await this.#credentials.read(credentialId)).toString()) as CodexCredentialJson;
      if (credential.account_id !== (await this.#workspaces.findById(row.workspace_id))?.external_id) throw new ServiceError(409, '凭证 Workspace 与数据库绑定不一致');
      const proxy = await this.operational.proxy(row.account_id);
      const snapshot = await fetchCodexQuota(credential, this.transport, proxy);
      await this.db.insertInto('credential_quota_snapshots').values({ credential_id: credentialId, payload: snapshot as any, observed_at: new Date() }).execute();
      return snapshot;
    } catch (error) { throw asServiceError(error); }
  }

  private async context(accountId: string, workspaceId: string) {
    const account = await this.db.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();
    const workspace = await this.#workspaces.findById(workspaceId);
    if (!account || !workspace) throw new ServiceError(404, '账号或 Workspace 不存在');
    const eligible = await this.db.selectFrom('workspace_memberships').select('id').where('account_id', '=', accountId).where('workspace_id', '=', workspaceId).where('status', '=', 'active').executeTakeFirst()
      ?? await this.db.selectFrom('workspace_invitations').select('id').where('workspace_id', '=', workspaceId).where('normalized_email', '=', account.normalized_email).where('status', '=', 'pending').executeTakeFirst();
    if (!eligible) throw new ServiceError(409, '账号与 Workspace 没有活动成员关系或待接受邀请');
    let accessToken = await this.sessions.accessToken(accountId, { kind: 'workspace', workspaceId });
    const proxy = await this.operational.proxy(accountId);
    if (!accessToken) {
      const session = await this.sessions.currentSession(accountId) as { sessionToken?: string } | undefined;
      if (!session?.sessionToken) throw new ServiceError(409, '账号缺少可换取 Workspace Token 的 sessionToken');
      accessToken = await fetchWorkspaceWebAccessTokenFromSessionToken(this.transport, session.sessionToken, workspace.external_id, proxy);
      await this.sessions.saveAccessToken(accountId, { kind: 'workspace', workspaceId }, accessToken, { checkedAt: new Date(), status: 'valid' });
    }
    return { account, workspace, api: new ChatGptApi({ accountId: workspace.external_id, accessToken, proxy }, this.transport) };
  }
}
