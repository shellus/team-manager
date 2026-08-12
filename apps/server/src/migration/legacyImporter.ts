import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ArtifactStore } from '../artifactStore.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { CredentialRepository } from '../repositories/credentialRepository.js';
import { SeatSlotRepository } from '../repositories/seatSlotRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { TeamOrderRepository } from '../repositories/teamOrderRepository.js';
import { ArtifactIndexRepository } from '../repositories/artifactIndexRepository.js';
import { normalizeEmail } from '../domain/identity.js';
import { SecretCipher, sha256 } from '../secretCipher.js';

type LegacyRecord = Record<string, unknown>;

export interface LegacyImportOptions {
  dataDir: string;
  artifactDir: string;
  cipher: SecretCipher;
}

export interface LegacyImportReport {
  version: 1;
  startedAt: string;
  completedAt: string;
  sources: Record<string, { sha256: string; bytes: number; records?: number }>;
  counts: Record<string, number>;
  conflicts: Array<{ code: string; sourceRef: string; resolution: string }>;
}

export class LegacyImporter {
  readonly #accounts: AccountRepository;
  readonly #workspaces: WorkspaceRepository;
  readonly #sessions: SessionRepository;
  readonly #credentials: CredentialRepository;
  readonly #seats: SeatSlotRepository;
  readonly #settings: SettingsRepository;
  readonly #billing: BillingRepository;
  readonly #teamOrders: TeamOrderRepository;
  readonly #artifactIndexes: ArtifactIndexRepository;
  readonly #artifacts: ArtifactStore;
  readonly #counts: Record<string, number> = {};
  readonly #conflicts: LegacyImportReport['conflicts'] = [];
  readonly #sources: LegacyImportReport['sources'] = {};

  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: LegacyImportOptions
  ) {
    this.#accounts = new AccountRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
    this.#sessions = new SessionRepository(db, options.cipher);
    this.#artifacts = new ArtifactStore(options.artifactDir);
    this.#credentials = new CredentialRepository(db, this.#artifacts);
    this.#seats = new SeatSlotRepository(db);
    this.#settings = new SettingsRepository(db, options.cipher);
    this.#billing = new BillingRepository(db);
    this.#teamOrders = new TeamOrderRepository(db);
    this.#artifactIndexes = new ArtifactIndexRepository(db, this.#artifacts);
  }

  async import(): Promise<LegacyImportReport> {
    const startedAt = new Date().toISOString();
    const existing = await sql<{ count: string }>`
      select (
        (select count(*) from accounts) +
        (select count(*) from workspaces) +
        (select count(*) from workspace_credentials) +
        (select count(*) from system_settings) +
        (select count(*) from upstream_trace_segments) +
        (select count(*) from rrweb_recordings)
      )::text as count
    `.execute(this.db);
    if (Number(existing.rows[0]?.count ?? 0) > 0) throw new Error('一次性迁移只允许写入空业务数据库');

    const parents = await this.readJsonArray('accounts.json');
    const children = await this.readJsonArray('subaccounts.json');
    const billing = await this.readJsonObjectOptional('account-billing-snapshots.json');
    const settings = await this.readJsonObjectOptional('app-settings.json');
    const teamOrders = await this.readJsonObjectOptional('team-orders.json');
    this.preflightAccountIdentities(parents, children);

    const accountByEmail = await this.importAccounts(parents, children);
    const workspaceByExternalId = await this.importWorkspaces(parents, children, billing);
    await this.importChildMemberships(children, accountByEmail, workspaceByExternalId);
    await this.importRemoteMembershipsAndInvitations(parents, accountByEmail, workspaceByExternalId);
    await this.importOwnerMemberships(parents, accountByEmail, workspaceByExternalId);
    await this.importCredentials(children, accountByEmail, workspaceByExternalId);
    await this.importSeatSlots(parents, workspaceByExternalId);
    await this.importSubscriptions(parents, children, accountByEmail, workspaceByExternalId);
    await this.importBilling(billing, parents, workspaceByExternalId);
    await this.importSettings(settings);
    await this.importTeamOrders(teamOrders, parents, accountByEmail, workspaceByExternalId);
    await this.importActivityLogs(accountByEmail, workspaceByExternalId);
    await this.importArtifactIndexes();
    await this.verifyArtifactReferences();

    return {
      version: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      sources: this.#sources,
      counts: this.#counts,
      conflicts: this.#conflicts
    };
  }

  private preflightAccountIdentities(parents: LegacyRecord[], children: LegacyRecord[]): void {
    const failures: LegacyImportReport['conflicts'] = [];
    for (const source of [...parents, ...children]) {
      const email = emailOf(source);
      const managed = normalizeEmail(text(source.managedAccountEmail));
      if (managed && managed !== email) {
        failures.push({ code: 'GAM_ACCOUNT_IDENTITY_MISMATCH', sourceRef: shortHash(email || managed), resolution: 'blocked' });
      }
      const sessionEmail = normalizeEmail(text(record(source.session)?.userEmail) || text(record(record(source.session)?.user)?.email));
      if (sessionEmail && sessionEmail !== email) {
        failures.push({ code: 'SESSION_EMAIL_MISMATCH', sourceRef: shortHash(email || sessionEmail), resolution: 'blocked' });
      }
    }
    if (failures.length > 0) {
      const error = new Error(`迁移前身份校验失败：${failures.length} 项`);
      Object.assign(error, { conflicts: failures });
      throw error;
    }
  }

  private async verifyArtifactReferences(): Promise<void> {
    const references = await sql<{ storage_key: string; content_sha256: string; byte_size: string }>`
      select storage_key, content_sha256, byte_size::text from workspace_credentials
      union all select storage_key, content_sha256, byte_size::text from upstream_trace_segments
      union all select storage_key, content_sha256, byte_size::text from rrweb_recordings
      union all select storage_key, content_sha256, byte_size::text from quarantined_artifacts
    `.execute(this.db);
    for (const reference of references.rows) {
      await this.#artifacts.verify(reference.storage_key, reference.content_sha256, Number(reference.byte_size));
    }
    this.#counts.artifactReferencesVerified = references.rows.length;
  }

  private async importAccounts(parents: LegacyRecord[], children: LegacyRecord[]): Promise<Map<string, string>> {
    const sources = new Map<string, { parents: LegacyRecord[]; children: LegacyRecord[] }>();
    for (const parent of parents) {
      const email = emailOf(parent);
      if (!email) continue;
      const source = sources.get(email) ?? { parents: [], children: [] };
      source.parents.push(parent);
      sources.set(email, source);
    }
    for (const child of children) {
      const email = emailOf(child);
      if (!email) continue;
      const source = sources.get(email) ?? { parents: [], children: [] };
      source.children.push(child);
      sources.set(email, source);
    }
    const result = new Map<string, string>();
    for (const [email, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
      const parent = source.parents[0];
      const child = source.children[0];
      const parentGroup = source.parents.map((item) => text(item.groupName)).find(Boolean) ?? '';
      const childGroup = source.children.map((item) => text(item.groupName)).find(Boolean) ?? '';
      const groupName = parentGroup || childGroup || '默认分组';
      if (parentGroup && childGroup && parentGroup.toLowerCase() !== childGroup.toLowerCase()) {
        this.#conflicts.push({
          code: 'ACCOUNT_GROUP_CONFLICT_PARENT_SELECTED',
          sourceRef: shortHash(email),
          resolution: 'parent_group'
        });
      }
      const groupId = await AccountRepository.ensureGroup(this.db as Parameters<typeof AccountRepository.ensureGroup>[0], groupName);
      const childPersonalId = text(child?.chatgptAccountId) || null;
      const created = await this.#accounts.create({
        email,
        groupId,
        remark: source.parents.map((item) => text(item.remark)).find(Boolean) || source.children.map((item) => text(item.remark)).find(Boolean) || null,
        isBanned: [...source.parents, ...source.children].some((item) => item.isBanned === true),
        remoteUserId: text(child?.chatgptUserId) || null,
        displayName: text(child?.remoteDisplayName) || text(child?.remoteUsername) || null,
        remotePersonalAccountId: childPersonalId
      });
      result.set(email, created.account.id);
      await this.importAccountDetails(created.account.id, created.personalSpace.id, source.parents, child);
    }
    this.#counts.accounts = result.size;
    this.#counts.accountGroups = (await this.#accounts.listGroups()).length;
    return result;
  }

  private async importAccountDetails(accountId: string, personalSpaceId: string, parents: LegacyRecord[], child?: LegacyRecord): Promise<void> {
    const parent = parents[0];
    const managedRef = parents.map((item) => text(item.managedAccountEmail)).find(Boolean) || text(child?.managedAccountEmail);
    if (managedRef) {
      await this.db.insertInto('gam_bindings').values({
        account_id: accountId,
        external_account_ref: managedRef,
        normalized_external_account_ref: normalizeEmail(managedRef)
      }).onConflict((oc) => oc.column('normalized_external_account_ref').doNothing()).execute();
    }
    const proxy = parents.map((item) => text(item.proxy)).find(Boolean) || text(child?.proxy);
    const encryptedProxy = proxy ? this.options.cipher.encrypt(proxy, `account-proxy:${accountId}`) : null;
    await this.db.updateTable('account_operational_profiles').set({
      limit_type: text(parent?.limitType) || 'unknown',
      proxy_url_ciphertext: encryptedProxy?.ciphertext ?? null,
      proxy_url_nonce: encryptedProxy?.nonce ?? null,
      proxy_url_auth_tag: encryptedProxy?.authTag ?? null,
      proxy_url_key_version: encryptedProxy?.keyVersion ?? null,
      account_manager_plan_code: parents.some((item) => item.accountManagerHasPro5x === true) || child?.accountManagerHasPro5x === true ? 'pro_5x' : null,
      account_manager_synced_at: dateFromEpoch(parents.map((item) => number(item.accountManagerSyncedAt)).find((value) => value !== undefined) ?? number(child?.accountManagerSyncedAt))
    }).where('account_id', '=', accountId).execute();

    const parentSessions = parents
      .map((source) => ({ source, session: sessionFromParent(source) }))
      .filter((item): item is { source: LegacyRecord; session: LegacyRecord } => Boolean(item.session));
    const childSession = sessionFromChild(child);
    for (const [index, item] of parentSessions.entries()) {
      await this.#sessions.saveRevision({
        accountId,
        session: item.session,
        source: 'legacy_parent',
        observedEmail: emailOf(item.source),
        makeCurrent: !childSession && index === parentSessions.length - 1
      });
    }
    if (childSession) {
      await this.#sessions.saveRevision({ accountId, session: childSession, source: 'legacy_child', observedEmail: emailOf(child), observedPersonalAccountId: text(child?.chatgptAccountId) || null });
      if (text(child?.webAccessToken)) {
        await this.#sessions.saveAccessToken(accountId, { kind: 'personal', personalSpaceId }, text(child?.webAccessToken), {
          checkedAt: dateFromEpoch(number(child?.webAccessTokenCheckedAt)),
          status: checkStatus(child?.webAccessTokenStatus)
        });
      }
    }
  }

  private async importWorkspaces(parents: LegacyRecord[], children: LegacyRecord[], billing: LegacyRecord): Promise<Map<string, string>> {
    const candidates = new Map<string, { source: LegacyRecord; evidence: 'parent' | 'team_link' | 'credential' | 'billing' }>();
    for (const parent of parents) {
      const externalId = text(parent.accountId);
      if (externalId) candidates.set(externalId, { source: parent, evidence: 'parent' });
    }
    for (const child of children) {
      for (const link of records(child.teamLinks)) {
        const externalId = text(link.workspaceId) || text(link.accountId);
        if (externalId && !candidates.has(externalId)) candidates.set(externalId, { source: link, evidence: 'team_link' });
      }
      for (const credential of records(child.codexCredentials)) {
        const externalId = text(credential.accountId);
        if (externalId && !candidates.has(externalId)) {
          candidates.set(externalId, { source: credential, evidence: 'credential' });
          this.#conflicts.push({ code: 'WORKSPACE_INFERRED_FROM_CREDENTIAL', sourceRef: shortHash(externalId), resolution: 'workspace_stub' });
        }
      }
    }
    for (const snapshot of Object.values(billing).map(record).filter((item): item is LegacyRecord => Boolean(item))) {
      const externalId = text(snapshot.workspaceAccountId);
      if (externalId && !candidates.has(externalId)) {
        candidates.set(externalId, { source: snapshot, evidence: 'billing' });
        this.#conflicts.push({ code: 'WORKSPACE_INFERRED_FROM_BILLING', sourceRef: shortHash(externalId), resolution: 'workspace_stub' });
      }
    }
    const result = new Map<string, string>();
    for (const [externalId, candidate] of candidates) {
      const { source, evidence } = candidate;
      const workspace = await this.#workspaces.upsert({
        externalId,
        name: text(source.workspaceName) || null,
        status: evidence === 'credential' || evidence === 'billing' ? 'unknown' : text(source.status) === 'removed' ? 'inactive' : 'active',
        rawPlanCode: text(source.planType) || null,
        normalizedPlan: normalizeWorkspacePlan(text(source.planType)),
        nextRenewalAt: parseLegacyDate(text(source.nextRenewalOn))
      });
      result.set(externalId, workspace.id);
    }
    this.#counts.workspaces = result.size;
    return result;
  }

  private async importChildMemberships(children: LegacyRecord[], accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    for (const child of children) {
      const accountId = accountByEmail.get(emailOf(child));
      if (!accountId) continue;
      for (const link of records(child.teamLinks)) {
        const workspace = workspaceByExternalId.get(text(link.workspaceId) || text(link.accountId));
        if (!workspace) continue;
        if (text(link.status) === 'invited') {
          await this.db.insertInto('workspace_invitations').values({
            workspace_id: workspace,
            account_id: accountId,
            remote_invitation_id: null,
            email: emailOf(child),
            normalized_email: emailOf(child),
            raw_role: text(link.role) || null,
            normalized_role: normalizeRole(text(link.role)),
            seat_type: normalizeSeat(text(link.seat)),
            status: 'pending',
            invited_at: dateFromEpoch(number(link.updatedAt)),
            observed_at: dateFromEpoch(number(link.updatedAt)) ?? new Date()
          }).onConflict((oc) => oc.doNothing()).execute();
          continue;
        }
        await this.#workspaces.upsertMembership({
          workspaceId: workspace,
          accountId,
          email: emailOf(child),
          rawRole: text(link.role) || null,
          normalizedRole: normalizeRole(text(link.role)),
          seatType: normalizeSeat(text(link.seat)),
          status: text(link.status) === 'removed' ? 'removed' : 'active',
          observedAt: dateFromEpoch(number(link.updatedAt)) ?? new Date(),
          source: 'legacy_child_team_link'
        });
      }
    }
  }

  private async importRemoteMembershipsAndInvitations(parents: LegacyRecord[], accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    for (const parent of parents) {
      const workspaceId = workspaceByExternalId.get(text(parent.accountId));
      if (!workspaceId) continue;
      for (const member of records(parent.membersCache)) {
        const email = emailOf(member);
        await this.#workspaces.upsertMembership({
          workspaceId,
          accountId: accountByEmail.get(email) ?? null,
          remoteUserId: text(member.userId) || null,
          email: email || null,
          displayName: text(member.remoteName) || null,
          rawRole: text(member.role) || null,
          normalizedRole: normalizeRole(text(member.role)),
          seatType: normalizeSeat(text(member.seat)),
          status: 'active',
          observedAt: dateFromEpoch(number(parent.membersCachedAt)) ?? new Date(),
          source: 'legacy_members_cache'
        });
      }
      for (const invitation of records(parent.pendingInvitesCache)) {
        const email = emailOf(invitation);
        if (!email) continue;
        await this.db.insertInto('workspace_invitations').values({
          workspace_id: workspaceId,
          account_id: accountByEmail.get(email) ?? null,
          remote_invitation_id: text(invitation.inviteId) || null,
          email,
          normalized_email: email,
          raw_role: text(invitation.role) || null,
          normalized_role: normalizeRole(text(invitation.role)),
          seat_type: normalizeSeat(text(invitation.seat)),
          status: 'pending',
          invited_at: parseLegacyDate(text(invitation.createdTime)),
          observed_at: dateFromEpoch(number(parent.pendingInvitesCachedAt)) ?? new Date()
        }).onConflict((oc) => oc.doNothing()).execute();
      }
    }
  }

  private async importOwnerMemberships(parents: LegacyRecord[], accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    for (const parent of parents) {
      const accountId = accountByEmail.get(emailOf(parent));
      const workspaceId = workspaceByExternalId.get(text(parent.accountId));
      if (!accountId || !workspaceId) continue;
      await this.#workspaces.upsertMembership({
        workspaceId,
        accountId,
        email: emailOf(parent),
        rawRole: text(parent.role) || 'inferred_legacy_manageable',
        normalizedRole: ['account-admin', 'admin'].includes(text(parent.role)) ? 'admin' : 'owner',
        seatType: normalizeSeat(text(parent.defaultSeat)),
        status: text(parent.status) === 'invalid' ? 'unknown' : 'active',
        observedAt: dateFromEpoch(number(parent.lastRefreshAt)) ?? new Date(),
        source: text(parent.role) ? 'legacy_parent' : 'inferred_legacy_manageable'
      });
      if (text(parent.accessToken)) {
        await this.#sessions.saveAccessToken(accountId, { kind: 'workspace', workspaceId }, text(parent.accessToken), {
          checkedAt: dateFromEpoch(number(parent.lastRefreshAt)),
          status: text(parent.status) === 'invalid' ? 'invalid' : text(parent.status) === 'active' ? 'valid' : 'unknown'
        });
      }
    }
    this.#counts.memberships = Number((await this.db.selectFrom('workspace_memberships').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count);
    this.#counts.invitations = Number((await this.db.selectFrom('workspace_invitations').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count);
  }

  private async importCredentials(children: LegacyRecord[], accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    const referencedFiles = new Set<string>();
    const childByLegacyId = new Map(children.map((child) => [text(child.id), child]));
    for (const child of children) {
      const accountId = accountByEmail.get(emailOf(child));
      if (!accountId) continue;
      for (const metadata of records(child.codexCredentials)) {
        const workspaceId = workspaceByExternalId.get(text(metadata.accountId));
        if (!workspaceId) throw new Error('凭证证据 Workspace 应已在预扫描阶段创建');
        const filePath = join(this.options.dataDir, 'subaccount-credentials', text(child.id), basename(text(metadata.fileName)));
        referencedFiles.add(filePath);
        let content: Buffer;
        try {
          content = await readFile(filePath);
        } catch {
          this.#conflicts.push({ code: 'CREDENTIAL_FILE_NOT_FOUND', sourceRef: shortHash(filePath), resolution: 'blocked' });
          continue;
        }
        const parsed = JSON.parse(content.toString('utf8')) as LegacyRecord;
        if (emailOf(parsed) !== emailOf(child)) {
          this.#conflicts.push({ code: 'CREDENTIAL_ACCOUNT_MISMATCH', sourceRef: shortHash(filePath), resolution: 'blocked' });
          continue;
        }
        if (text(parsed.account_id) !== text(metadata.accountId)) {
          this.#conflicts.push({ code: 'CREDENTIAL_WORKSPACE_MISMATCH', sourceRef: shortHash(filePath), resolution: 'blocked' });
          continue;
        }
        const poolGroupId = await this.#credentials.ensurePoolGroup(text(metadata.groupName) || '默认号池');
        await this.#credentials.save({
          accountId,
          workspaceId,
          poolGroupId,
          kind: text(parsed.credential_source) === 'oauth' ? 'oauth' : 'pat',
          fileName: basename(filePath),
          content,
          externalId: text(parsed.id) || null,
          eligibilitySource: 'migration'
        });
        this.#sources[`credential:${shortHash(filePath)}`] = { sha256: sha256(content), bytes: content.byteLength, records: 1 };
      }
    }
    const credentialRoot = join(this.options.dataDir, 'subaccount-credentials');
    let files: string[] = [];
    try { files = await readdir(credentialRoot, { recursive: true }); } catch { files = []; }
    for (const relativePath of files.filter((name) => name.endsWith('.json')).sort()) {
      const filePath = join(credentialRoot, relativePath);
      if (referencedFiles.has(filePath)) continue;
      const content = await readFile(filePath);
      this.#sources[`orphan-credential:${shortHash(relativePath)}`] = { sha256: sha256(content), bytes: content.byteLength, records: 1 };
      const [legacyChildId] = relativePath.split(/[\\/]/u);
      const child = childByLegacyId.get(legacyChildId ?? '');
      let parsed: LegacyRecord;
      try { parsed = record(JSON.parse(content.toString('utf8'))) ?? {}; } catch {
        this.#conflicts.push({ code: 'UNREFERENCED_CREDENTIAL_INVALID_JSON', sourceRef: shortHash(relativePath), resolution: 'blocked' });
        continue;
      }
      const accountId = accountByEmail.get(emailOf(parsed)) ?? (child ? accountByEmail.get(emailOf(child)) : undefined);
      const workspaceId = workspaceByExternalId.get(text(parsed.account_id));
      if (!accountId || !workspaceId || (child && emailOf(parsed) !== emailOf(child))) {
        await this.#artifactIndexes.quarantineCredential({
          fileName: basename(relativePath),
          content,
          reasonCode: !workspaceId ? 'WORKSPACE_NOT_FOUND' : 'ACCOUNT_NOT_FOUND',
          metadata: {
            workspaceExternalIdHash: text(parsed.account_id) ? shortHash(text(parsed.account_id)) : null,
            accountEmailHash: emailOf(parsed) ? shortHash(emailOf(parsed)) : null
          }
        });
        this.#conflicts.push({ code: 'UNREFERENCED_CREDENTIAL_QUARANTINED', sourceRef: shortHash(relativePath), resolution: 'quarantined' });
        continue;
      }
      const digest = sha256(content);
      const sameContent = await this.db.selectFrom('workspace_credentials').select(['id', 'account_id', 'workspace_id'])
        .where('content_sha256', '=', digest).executeTakeFirst();
      if (sameContent) {
        const resolution = sameContent.account_id === accountId && sameContent.workspace_id === workspaceId
          ? 'duplicate_content'
          : 'blocked';
        this.#conflicts.push({ code: 'UNREFERENCED_CREDENTIAL_DUPLICATE_CONTENT', sourceRef: shortHash(relativePath), resolution });
        continue;
      }
      const externalId = text(parsed.credential_id) || text(parsed.id) || null;
      const sameExternalId = externalId
        ? await this.db.selectFrom('workspace_credentials').select('id').where('external_id', '=', externalId).executeTakeFirst()
        : undefined;
      await this.#credentials.save({
        accountId,
        workspaceId,
        poolGroupId: await this.#credentials.ensurePoolGroup('历史凭证'),
        kind: text(parsed.credential_source) === 'oauth' ? 'oauth' : 'pat',
        fileName: basename(relativePath),
        content,
        externalId: sameExternalId ? null : externalId,
        eligibilitySource: 'migration',
        status: 'disabled'
      });
      this.#conflicts.push({ code: 'UNREFERENCED_CREDENTIAL_IMPORTED_DISABLED', sourceRef: shortHash(relativePath), resolution: 'disabled_history' });
    }
    this.#counts.credentials = Number((await this.db.selectFrom('workspace_credentials').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count);
    this.#counts.unreferencedCredentialFiles = files.filter((name) => name.endsWith('.json')).length - referencedFiles.size;
    this.#counts.quarantinedCredentialFiles = Number((await this.db.selectFrom('quarantined_artifacts').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count);
  }

  private async importSeatSlots(parents: LegacyRecord[], workspaceByExternalId: Map<string, string>): Promise<void> {
    for (const parent of parents) {
      const workspaceId = workspaceByExternalId.get(text(parent.accountId));
      if (!workspaceId) continue;
      for (const slot of records(parent.seatSlots)) {
        const seatKey = text(slot.seatKey);
        if (!seatKey) continue;
        const saved = await this.#seats.save({
          workspaceId,
          seatKey,
          email: emailOf(slot) || null,
          remoteUserId: text(slot.currentUserId) || null,
          contact: text(slot.contact) || null,
          remark: text(slot.remark) || null,
          price: text(slot.price) || null,
          expiresOn: text(slot.expiresOn) || null,
          expireReminder: slot.expireReminder === true,
          expireRemove: slot.expireRemove === true,
          seatType: normalizeSeat(text(slot.seat)) ?? 'default',
          status: normalizeSeatStatus(text(slot.status))
        });
        const swaps = uniqueRecordsById([...records(slot.swapHistory), ...records(slot.lastSwap)]);
        for (const swap of swaps) {
          const swapId = text(swap.id);
          if (!swapId || !text(swap.toEmail)) continue;
          await this.db.insertInto('seat_slot_identity_history').values({
            seat_slot_id: saved.id,
            previous_email: emailFrom(text(swap.fromEmail)) || null,
            next_email: emailFrom(text(swap.toEmail)) || null,
            changed_at: dateFromEpoch(number(swap.completedAt) ?? number(swap.updatedAt) ?? number(swap.startedAt)) ?? new Date(),
            reason: 'legacy_seat_swap'
          }).execute();
          await this.db.insertInto('seat_slot_swap_operations').values({
            seat_slot_id: saved.id,
            idempotency_key: `legacy-seat-swap:${saved.id}:${swapId}`,
            status: normalizeSwapStatus(text(swap.status)),
            requested_email: emailFrom(text(swap.toEmail)),
            error_message: text(swap.error) || null
          }).onConflict((oc) => oc.column('idempotency_key').doNothing()).execute();
        }
      }
    }
    this.#counts.seatSlots = Number((await this.db.selectFrom('seat_slots').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count);
  }

  private async importSubscriptions(parents: LegacyRecord[], children: LegacyRecord[], accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    const personalSeen = new Set<string>();
    for (const source of [...parents, ...children]) {
      const accountId = accountByEmail.get(emailOf(source));
      if (!accountId || personalSeen.has(accountId)) continue;
      const plan = personalPlan(source);
      if (!plan) continue;
      const space = await this.db.selectFrom('personal_spaces').select('id').where('account_id', '=', accountId).executeTakeFirstOrThrow();
      await this.db.insertInto('personal_subscription_snapshots').values({
        personal_space_id: space.id,
        normalized_plan: plan.normalized,
        raw_plan_code: plan.raw,
        status: 'active',
        will_renew: record(source.pro5xSubscription)?.willRenew === false ? false : null,
        effective_at: null,
        ends_at: text(record(source.pro5xSubscription)?.activeUntil) || null,
        payload: safeSnapshot(record(source.pro5xSubscription) ?? { migratedSignal: plan.raw }),
        observed_at: dateFromEpoch(number(source.pro5xSubscriptionCheckedAt) ?? number(source.accountManagerSyncedAt)) ?? new Date()
      }).execute();
      personalSeen.add(accountId);
    }
    for (const parent of parents) {
      const workspaceId = workspaceByExternalId.get(text(parent.accountId));
      if (!workspaceId || !text(parent.planType)) continue;
      await this.db.insertInto('workspace_subscription_snapshots').values({
        workspace_id: workspaceId,
        normalized_plan: normalizeWorkspacePlan(text(parent.planType)),
        raw_plan_code: text(parent.planType),
        status: parent.hasTeamSubscription === true ? 'active' : 'observed',
        will_renew: parent.hasTeamSubscription === true ? true : null,
        effective_at: null,
        ends_at: parseLegacyDate(text(parent.nextRenewalOn)),
        payload: { hasTeamSubscription: parent.hasTeamSubscription === true },
        observed_at: dateFromEpoch(number(parent.lastRefreshAt)) ?? new Date()
      }).execute();
    }
  }

  private async importBilling(billing: LegacyRecord, parents: LegacyRecord[], workspaceByExternalId: Map<string, string>): Promise<void> {
    const parentWorkspace = new Map(parents.map((parent) => [text(parent.id), text(parent.accountId)]));
    for (const [legacyAccountId, snapshot] of Object.entries(billing)) {
      const item = record(snapshot);
      if (!item) continue;
      const externalId = text(item.workspaceAccountId) || parentWorkspace.get(legacyAccountId) || '';
      const workspaceId = workspaceByExternalId.get(externalId);
      if (!workspaceId) {
        this.#conflicts.push({ code: 'BILLING_WORKSPACE_NOT_FOUND', sourceRef: shortHash(legacyAccountId), resolution: 'blocked' });
        continue;
      }
      await this.#billing.saveSnapshot(
        { kind: 'workspace', workspaceId },
        safeSnapshot(record(item.raw) ?? item),
        dateFromEpoch(number(item.refreshedAt)) ?? new Date()
      );
    }
    this.#counts.billingSnapshots = Object.keys(billing).length;
  }

  private async importSettings(settings: LegacyRecord): Promise<void> {
    const ordinary = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'channels'));
    await this.#settings.setValue('app-settings', safeSnapshot(ordinary));
    const channels = record(settings.channels);
    if (channels) {
      for (const [kind, configuration] of Object.entries(channels)) {
        const channel = record(configuration) ?? {};
        await this.#settings.setNotificationPolicy(kind, channel.enabled === true, {});
        await this.#settings.setSecret(`notification.channel.${kind}`, JSON.stringify(channel));
      }
    }
    this.#counts.notificationPolicies = Object.keys(channels ?? {}).length;
  }

  private async importTeamOrders(teamOrders: LegacyRecord, parents: LegacyRecord[], accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    const parentById = new Map(parents.map((parent) => [text(parent.id), parent]));
    const globalConfig = record(teamOrders.globalConfig) ?? {};
    await this.#teamOrders.saveConfiguration(null, {
      promoCode: text(globalConfig.promoCode) || null,
      country: text(globalConfig.country) || null,
      currency: text(globalConfig.currency) || null
    });
    for (const maintenance of records(teamOrders.maintenances)) {
      const parent = parentById.get(text(maintenance.accountId));
      if (!parent) continue;
      const accountId = accountByEmail.get(emailOf(parent));
      const workspaceId = workspaceByExternalId.get(text(parent.accountId));
      if (!accountId || !workspaceId) continue;
      const overrides = record(maintenance.overrides) ?? {};
      await this.#teamOrders.saveMaintenance({
        workspaceId,
        executorAccountId: accountId,
        enabled: text(maintenance.status) !== 'paused',
        overrides: {
          promoCode: text(overrides.promoCode) || null,
          country: text(overrides.country) || null,
          currency: text(overrides.currency) || null
        },
        nextRunAt: dateFromEpoch(number(maintenance.nextRunAt)),
        pauseReason: text(maintenance.pauseReason) || null,
        lastSuccessAt: dateFromEpoch(number(maintenance.lastSuccessAt)),
        lastRunAt: dateFromEpoch(number(maintenance.lastSuccessAt)),
        lastError: text(maintenance.lastError) || null
      });
    }
    for (const order of records(teamOrders.orders)) {
      const parent = parentById.get(text(order.accountId));
      if (!parent) {
        this.#conflicts.push({ code: 'TEAM_ORDER_ACCOUNT_NOT_FOUND', sourceRef: shortHash(text(order.id)), resolution: 'blocked' });
        continue;
      }
      const accountId = accountByEmail.get(emailOf(parent));
      const workspaceId = workspaceByExternalId.get(text(order.workspaceId) || text(parent.accountId));
      if (!accountId || !workspaceId) {
        this.#conflicts.push({ code: 'TEAM_ORDER_WORKSPACE_NOT_FOUND', sourceRef: shortHash(text(order.id)), resolution: 'blocked' });
        continue;
      }
      await this.#teamOrders.saveOrder({
        workspaceId,
        executorAccountId: accountId,
        externalOrderId: text(order.id) || null,
        checkoutUrl: text(order.payUrl) || null,
        expiresAt: dateFromEpoch(number(order.expiresAt)),
        status: text(order.status) || 'unknown',
        configuration: safeSnapshot(record(order.config) ?? {}),
        source: text(order.source) || 'manual',
        scheduledFor: dateFromEpoch(number(order.scheduledFor)),
        taskId: text(order.taskId) || null,
        stripeCreatedAt: dateFromEpoch(number(order.stripeCreatedAt)),
        retryAt: dateFromEpoch(number(order.retryAt)),
        attemptCount: number(order.attemptCount) ?? 0,
        errorMessage: text(order.error) || null,
        completedAt: dateFromEpoch(number(order.completedAt))
      });
    }
    this.#counts.teamOrderMaintenances = records(teamOrders.maintenances).length;
    this.#counts.teamUpgradeOrders = records(teamOrders.orders).length;
  }

  private async importActivityLogs(accountByEmail: Map<string, string>, workspaceByExternalId: Map<string, string>): Promise<void> {
    const path = join(this.options.dataDir, 'subaccount-auth-logs.jsonl');
    let content: Buffer;
    try { content = await readFile(path); } catch { return; }
    this.#sources['subaccount-auth-logs.jsonl'] = { sha256: sha256(content), bytes: content.byteLength };
    const lines = content.toString('utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line.trim()) continue;
      const item = JSON.parse(line) as LegacyRecord;
      const email = normalizeEmail(text(item.email));
      const workspaceExternalId = text(record(item.data)?.workspaceId) || text(record(item.data)?.accountId);
      await sql`insert into account_activity_logs (
          account_id, workspace_id, kind, payload, source_file_sha256, source_line, source_bytes_sha256, occurred_at
        ) values (
          ${accountByEmail.get(email) ?? null}::uuid,
          ${workspaceByExternalId.get(workspaceExternalId) ?? null}::uuid,
          ${text(item.phase) || 'legacy'},
          ${JSON.stringify(safeSnapshot(item))}::jsonb,
          ${this.#sources['subaccount-auth-logs.jsonl']!.sha256},
          ${index + 1},
          ${sha256(line)},
          ${dateFromEpoch(number(item.createdAt)) ?? new Date()}
        ) on conflict do nothing`.execute(this.db);
    }
    this.#counts.activityLogs = Number((await sql<{ count: string }>`select count(*)::text as count from account_activity_logs`.execute(this.db)).rows[0]?.count ?? 0);
  }

  private async importArtifactIndexes(): Promise<void> {
    const tracePath = join(this.options.dataDir, 'upstream-http-trace.jsonl');
    try {
      const content = await readFile(tracePath);
      await this.#artifactIndexes.save('traces', {
        fileName: basename(tracePath), content, recordedAt: (await stat(tracePath)).mtime,
        metadata: { legacyFile: basename(tracePath) }
      });
      this.#sources[basename(tracePath)] = { sha256: sha256(content), bytes: content.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const rrwebDir = join(this.options.dataDir, 'rrweb-recordings');
    let files: string[] = [];
    try { files = await readdir(rrwebDir); } catch { return; }
    for (const file of files.filter((name) => name.endsWith('.json.gz')).sort()) {
      const sourcePath = join(rrwebDir, file);
      const content = await readFile(sourcePath);
      await this.#artifactIndexes.save('rrweb', {
        fileName: file, content, recordedAt: (await stat(sourcePath)).mtime,
        metadata: { uuid: file.replace(/\.json\.gz$/, '') }
      });
      this.#sources[`rrweb:${shortHash(file)}`] = { sha256: sha256(content), bytes: content.byteLength, records: 1 };
    }
    this.#counts.rrwebRecordings = files.filter((name) => name.endsWith('.json.gz')).length;
  }

  private async readJsonArray(name: string): Promise<LegacyRecord[]> {
    const path = join(this.options.dataDir, name);
    const content = await readFile(path);
    const parsed = JSON.parse(content.toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error(`${name} 不是数组`);
    this.#sources[name] = { sha256: sha256(content), bytes: content.byteLength, records: parsed.length };
    return parsed.filter((item): item is LegacyRecord => Boolean(record(item)));
  }

  private async readJsonObjectOptional(name: string): Promise<LegacyRecord> {
    try {
      const content = await readFile(join(this.options.dataDir, name));
      const parsed = record(JSON.parse(content.toString('utf8'))) ?? {};
      this.#sources[name] = { sha256: sha256(content), bytes: content.byteLength, records: Object.keys(parsed).length };
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function record(value: unknown): LegacyRecord | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as LegacyRecord : undefined; }
function records(value: unknown): LegacyRecord[] { return Array.isArray(value) ? value.map(record).filter((item): item is LegacyRecord => Boolean(item)) : []; }
function emailOf(value: LegacyRecord | undefined): string { return normalizeEmail(text(value?.email) || text(value?.email_address)); }
function emailFrom(value: string): string { return value ? normalizeEmail(value) : ''; }
function shortHash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 16); }
function dateFromEpoch(value: number | undefined): Date | null { return value === undefined ? null : new Date(value < 10_000_000_000 ? value * 1000 : value); }
function parseLegacyDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function checkStatus(value: unknown): 'unknown' | 'valid' | 'invalid' { return value === 'valid' || value === 'invalid' ? value : 'unknown'; }
function normalizeSeat(value: string): 'default' | 'usage_based' | null { return value === 'default' || value === 'usage_based' ? value : null; }
function normalizeSeatStatus(value: string): 'empty' | 'invited' | 'member' | 'unknown' { return ['empty', 'invited', 'member'].includes(value) ? value as 'empty' | 'invited' | 'member' : 'unknown'; }
function normalizeSwapStatus(value: string): 'running' | 'succeeded' | 'failed' {
  return value === 'succeeded' || value === 'failed' ? value : 'running';
}
function uniqueRecordsById(items: LegacyRecord[]): LegacyRecord[] {
  const result = new Map<string, LegacyRecord>();
  for (const item of items) {
    const id = text(item.id);
    if (id) result.set(id, item);
  }
  return [...result.values()];
}
function normalizeRole(value: string): 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown' {
  if (['account-owner', 'owner'].includes(value)) return 'owner';
  if (['account-admin', 'admin'].includes(value)) return 'admin';
  if (value === 'analytics-viewer') return 'analytics_viewer';
  if (['standard-user', 'member'].includes(value)) return 'member';
  return 'unknown';
}
function normalizeWorkspacePlan(value: string): 'free' | 'business' | 'business_usage_based' | 'unknown' {
  if (value === 'free') return 'free';
  if (/usage_based/i.test(value)) return 'business_usage_based';
  if (/team|business/i.test(value)) return 'business';
  return 'unknown';
}
function personalPlan(source: LegacyRecord): { normalized: 'pro_5x' | 'pro_20x'; raw: string } | undefined {
  const raw = text(record(source.pro5xSubscription)?.planType);
  if (raw === 'prolite' || source.accountManagerHasPro5x === true) return { normalized: 'pro_5x', raw: raw || 'prolite' };
  if (raw === 'pro') return { normalized: 'pro_20x', raw };
  return undefined;
}
function sessionFromParent(parent?: LegacyRecord): LegacyRecord | undefined {
  if (!parent || !emailOf(parent) || !text(parent.accountId) || !text(parent.accessToken)) return undefined;
  return { user: { email: emailOf(parent) }, account: { id: text(parent.accountId) }, accessToken: text(parent.accessToken), ...(text(parent.sessionToken) ? { sessionToken: text(parent.sessionToken) } : {}) };
}
function sessionFromChild(child?: LegacyRecord): LegacyRecord | undefined {
  if (!child || !emailOf(child) || !text(child.chatgptAccountId) || !text(child.webAccessToken)) return undefined;
  return { user: { email: emailOf(child) }, account: { id: text(child.chatgptAccountId) }, accessToken: text(child.webAccessToken), ...(text(child.sessionToken) ? { sessionToken: text(child.sessionToken) } : {}) };
}
function safeSnapshot(value: LegacyRecord): LegacyRecord {
  const secretKeys = /token|cookie|password|secret|authorization|proxy|card|cvc|pan/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeys.test(key))
      .map(([key, item]) => [key, safeValue(item)])
  );
}
function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  const item = record(value);
  return item ? safeSnapshot(item) : value;
}
