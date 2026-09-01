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
  const map:Record<string,string>={account_removed:'彻底删除账号及本地关联数据',accounts_bulk_updated:'批量更新账号',personal_space_refresh:'刷新个人空间',personal_settings_changed:'更新个人设置',account_workspace_relationships_refreshed:'同步账号与 Workspace 关系',account_workspace_join_requested:'申请加入 Workspace',account_workspace_invitation_accepted:'接受 Workspace 邀请',account_workspace_exit_record_removed:'删除已退出 Workspace 记录',local_workspace_removed:'彻底删除本地 Workspace',workspace_invitation_created:'发送 Workspace 邀请',workspace_invitation_revoked:'撤销 Workspace 邀请',workspace_member_removed:'移除 Workspace 成员',workspace_member_seat_changed:'调整成员席位',workspace_member_role_changed:'调整成员角色',workspace_renamed:'重命名 Workspace',workspace_settings_changed:'更新 Workspace 设置',workspace_promotion_applied:'应用 Workspace 优惠码',workspace_promotion_unverified:'Workspace 优惠码等待回读确认',workspace_order_link_generated:'生成 Workspace 订单链接',workspace_order_link_generation_failed:'生成 Workspace 订单链接失败',credential_created:'创建凭证',credential_pat_created:'创建 PAT 凭证',credential_oauth_created:'创建 OAuth 凭证',credential_replaced:'替换凭证',credential_status_changed:'调整凭证状态',credential_removed:'删除凭证',credential_deployed:'投放凭证',credential_quota_refreshed:'刷新凭证额度',seat_slot_created:'创建客户席位',seat_slot_updated:'更新客户席位',seat_slot_removed:'删除客户席位',seat_slot_released:'释放客户席位',seat_slot_expiration_removal_succeeded:'客户席位自动移除成功',seat_slot_expiration_removal_failed:'客户席位自动移除失败',seat_slot_swap_requested:'人工更换席位账号'};
  const email=typeof payload.email==='string'?payload.email:undefined;const name=typeof payload.name==='string'?payload.name:undefined;const remoteUserId=typeof payload.remoteUserId==='string'?payload.remoteUserId:undefined;
  const previousEmail=typeof payload.previousEmail==='string'?payload.previousEmail:undefined;const status=typeof payload.status==='string'?payload.status:undefined;const promoCode=typeof payload.promoCode==='string'?payload.promoCode:undefined;const workspaceExternalId=typeof payload.workspaceExternalId==='string'?payload.workspaceExternalId:undefined;const error=typeof payload.error==='string'?payload.error:undefined;
  const billing=(payload.hasBillingNotice===true||payload.billingNotice!==null&&payload.billingNotice!==undefined)?'；上游返回账单提示':'';const policyValue=payload.policy??payload.policyNotice;const policy=policyValue&&typeof policyValue==='object'&&!Array.isArray(policyValue)?policyValue as Record<string,unknown>:undefined;
  const billedSeatDelta=typeof policy?.billedSeatDelta==='number'?policy.billedSeatDelta:typeof policy?.billed_seat_delta==='number'?policy.billed_seat_delta:undefined;const policyDetail=policy?`；策略 ${typeof policy.kind==='string'?policy.kind:'未识别'}${billedSeatDelta!==undefined?`，计费席位变化 ${billedSeatDelta}`:''}`:'';
  const changedFields=Array.isArray(payload.changedFields)?payload.changedFields.filter(item=>typeof item==='string').map(String):[];
  if (kind === 'workspace_order_link_generated' || kind === 'workspace_order_link_generation_failed') {
    return [map[kind], workspaceOrderLinkActivityText(payload)];
  }
  return [map[kind]??'业务记录',resources?`范围：${resources}`:email?`邮箱：${email}${changedFields.length?`；变更：${seatChangeText(payload,changedFields)}`:''}${error?`；原因：${error}`:''}${billing}${policyDetail}`:previousEmail?`原邮箱：${previousEmail}`:name?`名称：${name}`:remoteUserId?`成员：${remoteUserId}${billing}${policyDetail}`:promoCode?`优惠码：${promoCode}`:workspaceExternalId?`Workspace ID：${workspaceExternalId}`:status?`状态：${status}`:undefined];
}
function workspaceOrderLinkActivityText(payload:Record<string,unknown>){
  const mode=payload.mode==='upgrade_existing_workspace'?'升级空间':'新开空间';
  const workspaceName=typeof payload.workspaceName==='string'?payload.workspaceName:'Workspace';
  const seatQuantity=typeof payload.seatQuantity==='number'?`${payload.seatQuantity} 席位`:'席位数未知';
  const country=typeof payload.country==='string'?payload.country:'';const currency=typeof payload.currency==='string'?payload.currency:'';
  const promo=payload.hasPromoCode===true?'已填写优惠码':'未填写优惠码';const error=typeof payload.error==='string'?`；原因：${payload.error}`:'';
  return `${mode} · ${workspaceName} · ${seatQuantity} · ${[country,currency].filter(Boolean).join('/')||'账单地区未知'} · ${promo}${error}`;
}
function seatFieldLabel(value:string){return({contact:'联系方式',remark:'备注',price:'价格',expiresOn:'到期日',expireReminder:'到期提醒',expireRemove:'到期移除',seatType:'席位类型'} as Record<string,string>)[value]??value;}
function seatChangeText(payload:Record<string,unknown>,fields:string[]){const before=record(payload.before),after=record(payload.after);return fields.map(field=>['expiresOn','expireReminder','expireRemove','seatType'].includes(field)?`${seatFieldLabel(field)} ${auditValue(before?.[field])} → ${auditValue(after?.[field])}`:seatFieldLabel(field)).join('、');}
function auditValue(value:unknown){if(value===true)return'开启';if(value===false)return'关闭';if(value===null||value===undefined||value==='')return'未设置';return String(value);}
function record(value:unknown){return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
