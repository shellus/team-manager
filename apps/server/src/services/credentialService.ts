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
import { createCodexAuthSession, exchangeCodexCallback } from '../codexAuth.js';
import { SecretCipher } from '../secretCipher.js';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

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
    private readonly transport: Transport,
    private readonly cipher: SecretCipher
  ) {
    this.#credentials = new CredentialRepository(db, artifacts);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async content(id: string) { return JSON.parse((await this.#credentials.read(id)).toString()) as CodexCredentialJson; }
  async replace(id: string, content: unknown) {
    const row = await this.db.selectFrom('workspace_credentials').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new ServiceError(404, 'Workspace 凭证不存在');
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (!parsed || typeof parsed !== 'object') throw new ServiceError(400, '凭证 JSON 无效');
    const expected = await this.#workspaces.findById(row.workspace_id); if ((parsed as any).account_id !== expected?.external_id) throw new ServiceError(409, '凭证 Workspace 与目标不一致');
    const saved = await this.#credentials.save({ accountId: row.account_id, workspaceId: row.workspace_id, kind: row.kind as any,
      fileName: `replacement-${id}.json`, content: Buffer.from(JSON.stringify(parsed)), externalId: row.external_id, poolGroupId: row.pool_group_id });
    await this.db.updateTable('workspace_credentials').set({ status: 'disabled', disabled_at: new Date() }).where('id', '=', id).execute(); return saved;
  }
  async setStatus(id: string, status: 'active' | 'disabled' | 'revoked') { const row = await this.db.updateTable('workspace_credentials').set({ status, disabled_at: status === 'active' ? null : new Date() }).where('id', '=', id).returningAll().executeTakeFirst(); if (!row) throw new ServiceError(404, '凭证不存在'); return row; }
  async remove(id: string) { const row = await this.db.selectFrom('workspace_credentials').selectAll().where('id', '=', id).executeTakeFirst(); if (!row) throw new ServiceError(404, '凭证不存在'); if (row.status === 'active') throw new ServiceError(409, '活动凭证必须先停用'); await this.db.deleteFrom('workspace_credentials').where('id', '=', id).execute(); return true; }
  async startOauth(accountId: string, workspaceId: string) {
    const { account, workspace } = await this.context(accountId, workspaceId); const session = createCodexAuthSession(account.email);
    const encrypted = this.cipher.encrypt(session.codeVerifier, `codex-oauth:${session.id}`);
    await this.db.insertInto('codex_oauth_sessions').values({ id: session.id, account_id: accountId, workspace_id: workspaceId, state: session.state,
      verifier_ciphertext: encrypted.ciphertext, verifier_nonce: encrypted.nonce, verifier_auth_tag: encrypted.authTag, verifier_key_version: encrypted.keyVersion,
      auth_url: session.authUrl, expires_at: new Date(session.expiresAt), consumed_at: null }).execute();
    return { sessionId: session.id, authUrl: session.authUrl, expiresAt: session.expiresAt, targetChatgptAccountId: workspace.external_id };
  }
  async completeOauth(sessionId: string, callbackUrl: string, poolGroup?: string) {
    const row = await this.db.selectFrom('codex_oauth_sessions').selectAll().where('id', '=', sessionId).executeTakeFirst();
    if (!row || row.consumed_at) throw new ServiceError(404, 'OAuth 会话不存在或已使用'); if (new Date(row.expires_at as any).getTime() < Date.now()) throw new ServiceError(410, 'OAuth 会话已过期');
    const workspace = await this.#workspaces.findById(row.workspace_id); const account = await this.db.selectFrom('accounts').selectAll().where('id', '=', row.account_id).executeTakeFirstOrThrow();
    const credential = await exchangeCodexCallback({ callbackUrl, state: row.state,
      codeVerifier: this.cipher.decrypt({ ciphertext: row.verifier_ciphertext, nonce: row.verifier_nonce, authTag: row.verifier_auth_tag, keyVersion: row.verifier_key_version }, `codex-oauth:${row.id}`),
      transport: this.transport, proxy: await this.operational.proxy(row.account_id) });
    if (credential.account_id !== workspace?.external_id) throw new ServiceError(409, 'OAuth 凭证 Workspace 与目标不一致');
    const saved = await this.#credentials.save({ accountId: row.account_id, workspaceId: row.workspace_id, kind: 'oauth', fileName: `${account.email}-${workspace.external_id}-oauth.json`, content: Buffer.from(JSON.stringify(credential)), poolGroupId: poolGroup ? await this.#credentials.ensurePoolGroup(poolGroup) : null });
    await this.db.updateTable('codex_oauth_sessions').set({ consumed_at: new Date() }).where('id', '=', row.id).execute(); return { id: saved.id };
  }

  async poolGroups() { const rows = await this.db.selectFrom('credential_pool_groups as g').leftJoin('workspace_credentials as c', 'c.pool_group_id', 'g.id').select(['g.id','g.name','g.sort_order']).select(({ fn }) => fn.count('c.id').as('count')).groupBy('g.id').orderBy('g.sort_order').execute(); return rows.map((r) => ({ id:r.id,name:r.name,sortOrder:r.sort_order,credentialCount:Number(r.count) })); }
  async createPoolGroup(name: string) { await this.#credentials.ensurePoolGroup(name); return this.poolGroups(); }
  async updatePoolGroup(id: string, input: { name?: string; sortOrder?: number }) { const patch: any = {}; if (input.name?.trim()) { patch.name=input.name.trim(); patch.normalized_name=input.name.trim().toLowerCase(); } if (Number.isInteger(input.sortOrder)) patch.sort_order=input.sortOrder; if (!await this.db.updateTable('credential_pool_groups').set(patch).where('id','=',id).returning('id').executeTakeFirst()) throw new ServiceError(404,'号池分组不存在'); return this.poolGroups(); }
  async deletePoolGroup(id: string) { const count = await this.db.selectFrom('workspace_credentials').select(({fn})=>fn.countAll().as('count')).where('pool_group_id','=',id).executeTakeFirstOrThrow(); if(Number(count.count)>0) throw new ServiceError(409,'非空号池分组不能删除'); await this.db.deleteFrom('credential_pool_groups').where('id','=',id).execute(); return this.poolGroups(); }
  async reconcileEligibility(workspaceId: string) { const rows=await this.db.selectFrom('workspace_credentials as c').innerJoin('accounts as a','a.id','c.account_id').select(['c.id','c.account_id','a.normalized_email']).where('c.workspace_id','=',workspaceId).execute(); for(const row of rows){ const eligible=await this.db.selectFrom('workspace_memberships').select('id').where('workspace_id','=',workspaceId).where('account_id','=',row.account_id).where('status','=','active').executeTakeFirst() ?? await this.db.selectFrom('workspace_invitations').select('id').where('workspace_id','=',workspaceId).where('normalized_email','=',row.normalized_email).where('status','=','pending').executeTakeFirst(); await this.db.updateTable('workspace_credentials').set({status:eligible?'active':'disabled',disabled_at:eligible?null:new Date()}).where('id','=',row.id).execute(); } return {checked:rows.length}; }
  async deploy(credentialId:string,input:{targetKey?:string;fileName?:string}){const row=await this.db.selectFrom('workspace_credentials').selectAll().where('id','=',credentialId).where('status','=','active').executeTakeFirst();if(!row)throw new ServiceError(404,'活动凭证不存在');const setting=await this.db.selectFrom('system_settings').selectAll().where('key','=','credential_deployment_targets').where('is_secret','=',false).executeTakeFirst();const targets=setting?.value.targets;if(!targets||typeof targets!=='object'||Array.isArray(targets))throw new ServiceError(409,'尚未配置凭证投放目标');const target=(targets as Record<string,unknown>)[input.targetKey??'default'];const directory=typeof target==='string'?target:target&&typeof target==='object'&&!Array.isArray(target)&&typeof (target as any).directory==='string'?(target as any).directory:'';if(!directory)throw new ServiceError(404,'凭证投放目标不存在');const root=resolve(directory);const file=basename(input.fileName?.trim()||`${credentialId}.json`).replace(/[^a-zA-Z0-9._-]+/g,'-');const destination=resolve(root,file);if(!destination.startsWith(`${root}${sep}`))throw new ServiceError(400,'投放路径越界');const content=await this.#credentials.read(credentialId);await mkdir(root,{recursive:true,mode:0o700});const temp=`${destination}.${randomUUID()}.tmp`;const handle=await open(temp,'wx',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}try{await rename(temp,destination);}catch(error){await unlink(temp).catch(()=>undefined);throw error;}const operation=await this.db.insertInto('automation_operations').values({account_id:row.account_id,workspace_id:row.workspace_id,target_group_id:null,kind:'deploy_workspace_credential',idempotency_key:randomUUID(),external_operation_id:null,status:'succeeded',phase:'deployed',safe_request_summary:{credentialId,targetKey:input.targetKey??'default',fileName:file},result_summary:{destination,byteSize:content.byteLength},error_code:null,error_message:null,completed_at:new Date(),effective_at:new Date(),last_polled_at:null,converged_at:new Date()}).returning('id').executeTakeFirstOrThrow();return{operationId:operation.id,destination,byteSize:content.byteLength};}

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
