import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { PublicSeatSlotView } from '@team-manager/shared';
import type { Database, SeatSlotRow } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { WorkspaceOperationService } from './workspaceOperationService.js';

export class PublicSeatService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly operations: WorkspaceOperationService
  ) {}

  async get(seatKey: string): Promise<PublicSeatSlotView> {
    const row = await this.row(seatKey);
    return this.view(row);
  }

  async swap(seatKey: string, rawEmail: string): Promise<PublicSeatSlotView> {
    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@')) throw new ServiceError(400, '邮箱格式无效');
    const row = await this.row(seatKey);
    if (row.seat_type === 'default' && row.status === 'member') {
      throw new ServiceError(409, '标准 ChatGPT 已接受成员不能自动换号，请由管理员核对 Billing 后处理');
    }
    if (row.normalized_current_email === email && ['member', 'invited'].includes(row.status)) return this.view(row);
    const executor = await this.db.selectFrom('workspace_memberships').select('account_id')
      .where('workspace_id', '=', row.workspace_id).where('status', '=', 'active')
      .where('normalized_role', 'in', ['owner', 'admin']).where('account_id', 'is not', null)
      .orderBy('normalized_role').executeTakeFirst();
    if (!executor?.account_id) throw new ServiceError(409, 'Workspace 没有可用的管理账号');
    const operation = await this.db.insertInto('seat_slot_swap_operations').values({
      seat_slot_id: row.id, idempotency_key: randomUUID(), status: 'running',
      requested_email: email, error_message: null, from_email: row.current_email,
      steps: { items: steps('running') }, completed_at: null
    }).returning('id').executeTakeFirstOrThrow().catch((error) => { throw asServiceError(error); });
    try {
      if (row.status === 'invited' && row.current_email) {
        await this.operations.revokeInvitation(row.workspace_id, executor.account_id, row.current_email);
      } else if (row.status === 'member' && row.remote_user_id) {
        await this.operations.removeMember(row.workspace_id, executor.account_id, row.remote_user_id);
      }
      await this.operations.invite(row.workspace_id, executor.account_id, {
        email, ...(row.seat_type === 'default' || row.seat_type === 'usage_based' ? { seat: row.seat_type } : {})
      });
      await this.db.transaction().execute(async (trx) => {
        await trx.insertInto('seat_slot_identity_history').values({
          seat_slot_id: row.id, previous_email: row.current_email, next_email: email,
          changed_at: new Date(), reason: 'public_swap'
        }).execute();
        await trx.updateTable('seat_slots').set({
          current_email: email, normalized_current_email: email, remote_user_id: null, status: 'invited'
        }).where('id', '=', row.id).execute();
        await trx.updateTable('seat_slot_swap_operations').set({ status: 'succeeded', steps: { items: steps('succeeded') }, completed_at: new Date() }).where('id', '=', operation.id).execute();
      });
      return this.get(seatKey);
    } catch (error) {
      await this.db.updateTable('seat_slot_swap_operations').set({
        status: 'failed', error_message: error instanceof Error ? error.message : String(error),
        steps: { items: steps('failed', error instanceof Error ? error.message : String(error)) }, completed_at: new Date()
      }).where('id', '=', operation.id).execute();
      throw asServiceError(error);
    }
  }

  private async view(row: SeatSlotRow): Promise<PublicSeatSlotView> {
    const operations = await this.db.selectFrom('seat_slot_swap_operations').selectAll().where('seat_slot_id', '=', row.id).orderBy('created_at', 'desc').limit(20).execute();
    const history = operations.map((item) => ({ id: item.id, status: swapStatus(item.status),
      ...(item.from_email ? { fromEmail: item.from_email } : {}), toEmail: item.requested_email,
      startedAt: new Date(item.created_at as any).getTime(), updatedAt: new Date(item.updated_at as any).getTime(),
      ...(item.completed_at ? { completedAt: new Date(item.completed_at as any).getTime() } : {}),
      ...(item.error_message ? { error: item.error_message } : {}), steps: stepsFrom(item.steps) }));
    return { ...seatView(row), ...(history[0] && history[0].status === 'running' ? { swap: history[0] } : {}), swapHistory: history };
  }

  private async row(seatKey: string) {
    const row = await this.db.selectFrom('seat_slots').selectAll().where('seat_key', '=', seatKey.trim()).executeTakeFirst();
    if (!row) throw new ServiceError(404, '席位不存在');
    return row;
  }
}

function steps(status: 'running' | 'succeeded' | 'failed', error?: string) {
  const keys = ['refreshing_workspace', 'confirming_current_email', 'removing_current_member', 'revoking_current_invite', 'inviting_new_email', 'saving_new_profile', 'refreshing_final_state'] as const;
  return keys.map((key, index) => ({ key, label: key, status: status === 'running' ? (index === 0 ? 'running' : 'pending') : status === 'succeeded' ? 'done' : (index === 0 ? 'failed' : 'skipped'), ...(error && index === 0 ? { message: error } : {}), at: Date.now() }));
}
function stepsFrom(value: Record<string, unknown>) { return Array.isArray(value.items) ? value.items as any : []; }
function swapStatus(value: string): 'running' | 'succeeded' | 'failed' { return value === 'succeeded' || value === 'failed' ? value : 'running'; }

function seatView(row: SeatSlotRow): PublicSeatSlotView {
  return {
    seatKey: row.seat_key,
    ...(row.current_email ? { email: row.current_email } : {}),
    ...(row.contact ? { contact: row.contact } : {}),
    ...(row.remark ? { remark: row.remark } : {}),
    expiresOn: row.expires_on ?? '',
    ...(row.price ? { price: row.price } : {}),
    ...(row.seat_type === 'default' || row.seat_type === 'usage_based' ? { seat: row.seat_type } : {}),
    status: publicStatus(row.status)
  };
}

function publicStatus(value: string): PublicSeatSlotView['status'] {
  return value === 'member' || value === 'invited' || value === 'empty' ? value : 'unknown';
}
