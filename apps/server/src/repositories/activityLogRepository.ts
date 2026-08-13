import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';

export class ActivityLogRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async log(input: {
    accountId?: string | null;
    workspaceId?: string | null;
    kind: string;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void> {
    await this.db.insertInto('account_activity_logs').values({
      account_id: input.accountId ?? null,
      workspace_id: input.workspaceId ?? null,
      kind: input.kind,
      payload: input.payload ?? {},
      source_file_sha256: null,
      source_line: null,
      source_bytes_sha256: null,
      occurred_at: input.occurredAt ?? new Date()
    }).execute();
  }

  async list(input: { accountId?: string; workspaceId?: string; limit?: number }) {
    let query = this.db.selectFrom('account_activity_logs').selectAll();
    if (input.accountId) query = query.where('account_id', '=', input.accountId);
    if (input.workspaceId) query = query.where('workspace_id', '=', input.workspaceId);
    const rows = await query.orderBy('occurred_at', 'desc').limit(Math.min(Math.max(input.limit ?? 200, 1), 1000)).execute();
    return rows.map((row) => {
      const [title, detail] = activityText(row.kind, row.payload);
      return { id: row.id, ...(row.account_id ? { accountId: row.account_id } : {}), ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
        kind: row.kind, title, ...(detail ? { detail } : {}), occurredAt: new Date(row.occurred_at as any).toISOString() };
    });
  }
}

function activityText(kind:string,payload:Record<string,unknown>):[string,string?]{
  const resources=Array.isArray(payload.resources)?payload.resources.join('、'):undefined;
  const map:Record<string,string>={personal_space_refresh:'刷新个人空间',personal_settings_changed:'更新个人设置',workspace_invitation_created:'发送 Workspace 邀请',workspace_invitation_revoked:'撤销 Workspace 邀请',workspace_member_removed:'移除 Workspace 成员',workspace_member_seat_changed:'调整成员席位',workspace_member_role_changed:'调整成员角色',workspace_renamed:'重命名 Workspace',workspace_settings_changed:'更新 Workspace 设置',credential_created:'创建凭证',credential_replaced:'替换凭证',credential_deployed:'投放凭证',credential_quota_refreshed:'刷新凭证额度',seat_slot_created:'创建客户席位',seat_slot_updated:'更新客户席位',seat_slot_deleted:'删除客户席位'};
  const email=typeof payload.email==='string'?payload.email:undefined;const name=typeof payload.name==='string'?payload.name:undefined;const remoteUserId=typeof payload.remoteUserId==='string'?payload.remoteUserId:undefined;
  return [map[kind]??'业务记录',resources?`范围：${resources}`:email?`邮箱：${email}`:name?`名称：${name}`:remoteUserId?`成员：${remoteUserId}`:undefined];
}
