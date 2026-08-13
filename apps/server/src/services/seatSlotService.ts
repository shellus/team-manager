import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SeatSlotMutationInput, SeatType } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';
import { SeatSlotRepository } from '../repositories/seatSlotRepository.js';
import { ServiceError } from '../serviceError.js';
import { PublicSeatService } from './publicSeatService.js';
import { WorkspaceOperationService } from './workspaceOperationService.js';
import type { NotificationService } from './notificationService.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';

export class SeatSlotService {
  readonly #repository: SeatSlotRepository;
  readonly #activity: ActivityLogRepository;
  constructor(
    private readonly db: Kysely<Database>, private readonly workspaceOperations: WorkspaceOperationService,
    private readonly publicSeats: PublicSeatService, private readonly notifications?: NotificationService
  ) { this.#repository = new SeatSlotRepository(db); this.#activity = new ActivityLogRepository(db); }

  list(workspaceId: string) { return this.db.selectFrom('seat_slots').selectAll().where('workspace_id', '=', workspaceId).orderBy('created_at').execute(); }

  async create(workspaceId: string, input: SeatSlotMutationInput) {
    const seatKey = input.seatKey?.trim() || randomBytes(24).toString('base64url');
    if (!['default', 'usage_based'].includes(input.seatType ?? '')) throw new ServiceError(400, '缺少有效席位类型');
    await this.assertWorkspace(workspaceId);
    const row = await this.#repository.save({ workspaceId, seatKey, email: input.email, remoteUserId: input.remoteUserId,
      contact: input.contact, remark: input.remark, price: input.price, expiresOn: input.expiresOn,
      expireReminder: input.expireReminder, expireRemove: input.expireRemove,
      seatType: input.seatType!, status: input.status ?? (input.email ? 'unknown' : 'empty') });
    await this.log(row.id, null, row.current_email, 'created');await this.activity(workspaceId,'seat_slot_created',{seatSlotId:row.id,email:row.current_email,seatType:row.seat_type}); return row;
  }

  async update(workspaceId: string, id: string, input: SeatSlotMutationInput) {
    const row = await this.require(workspaceId, id); const email = input.email === undefined ? row.current_email : input.email;
    const updated = await this.#repository.save({ workspaceId, seatKey: row.seat_key, email,
      remoteUserId: input.remoteUserId === undefined ? row.remote_user_id : input.remoteUserId,
      contact: input.contact === undefined ? row.contact : input.contact, remark: input.remark === undefined ? row.remark : input.remark,
      price: input.price === undefined ? row.price : input.price, expiresOn: input.expiresOn === undefined ? row.expires_on : input.expiresOn,
      expireReminder: input.expireReminder ?? row.expire_reminder, expireRemove: input.expireRemove ?? row.expire_remove,
      seatType: input.seatType ?? row.seat_type as SeatType,
      status: input.status ?? row.status as any });
    if (row.normalized_current_email !== updated.normalized_current_email) await this.log(id, row.current_email, updated.current_email, 'admin_edit');
    await this.activity(workspaceId,'seat_slot_updated',{seatSlotId:id,email:updated.current_email,status:updated.status,seatType:updated.seat_type});
    return updated;
  }

  async disable(workspaceId: string, id: string) { await this.require(workspaceId, id);const row=await this.db.updateTable('seat_slots').set({ status: 'disabled' }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();await this.activity(workspaceId,'seat_slot_disabled',{seatSlotId:id});return row; }
  async remove(workspaceId: string, id: string) { const row = await this.require(workspaceId, id); if (['member', 'invited'].includes(row.status)) throw new ServiceError(409, '占用中的席位不能删除，请先释放'); await this.db.deleteFrom('seat_slots').where('id', '=', id).execute();await this.activity(workspaceId,'seat_slot_removed',{seatSlotId:id}); return true; }
  async release(workspaceId: string, id: string, executorAccountId: string, force = false) {
    const row = await this.require(workspaceId, id);
    if (row.status === 'member' && row.remote_user_id && !force) await this.workspaceOperations.removeMember(workspaceId, executorAccountId, row.remote_user_id);
    else if (row.status === 'invited' && row.current_email && !force) await this.workspaceOperations.revokeInvitation(workspaceId, executorAccountId, row.current_email);
    await this.log(id, row.current_email, null, force ? 'force_release' : 'release');
    const released=await this.db.updateTable('seat_slots').set({ current_email: null, normalized_current_email: null, remote_user_id: null, status: 'empty' }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();await this.#activity.log({accountId:executorAccountId,workspaceId,kind:'seat_slot_released',payload:{seatSlotId:id,previousEmail:row.current_email,force}});return released;
  }
  async swap(workspaceId: string, id: string, email: string) { const row = await this.require(workspaceId, id);const result=await this.publicSeats.swap(row.seat_key, normalizeEmail(email));await this.activity(workspaceId,'seat_slot_swap_requested',{seatSlotId:id,email:normalizeEmail(email)});return result; }

  async runExpirations(now = new Date()) {
    const today = dateInTimeZone(now, 'UTC'); const schedules = await this.notificationSchedules();
    const dueSchedules = schedules.filter((schedule) => notificationScheduleDue(schedule, now));
    const advanceDays = dueSchedules.length ? Math.max(...dueSchedules.map((item) => item.advanceDays)) : -1;
    const reminderEnd = advanceDays >= 0 ? new Date(now.getTime()+advanceDays*86400_000).toISOString().slice(0,10) : today;
    const reminders=await this.db.selectFrom('seat_slots').selectAll().where('expire_reminder','=',true)
      .where('status','in',['invited','member']).where('current_email','is not',null)
      .where('expires_on','>=',today).where('expires_on','<=',reminderEnd).execute();
    for (const schedule of dueSchedules) {
      const reminderKey=`seat-expiry-reminder:${schedule.kind}:${dateInTimeZone(now,schedule.timeZone)}`;const already=await this.db.selectFrom('system_settings').select('key').where('key','=',reminderKey).executeTakeFirst();
      const matching=reminders.filter(row=>row.expires_on&&row.expires_on<=new Date(now.getTime()+schedule.advanceDays*86400_000).toISOString().slice(0,10));
      if(matching.length&&!already){await this.notifications?.notifySeatExpiry(matching.map(row=>({seatSlotId:row.id,email:row.current_email,expiresOn:row.expires_on,workspaceId:row.workspace_id})),schedule.kind);await this.db.insertInto('system_settings').values({key:reminderKey,value:{count:matching.length,runAt:now.toISOString()},is_secret:false,ciphertext:null,nonce:null,auth_tag:null,key_version:null}).onConflict(oc=>oc.column('key').doNothing()).execute();}
    }
    const rows = await this.db.selectFrom('seat_slots').selectAll().where('expires_on', '<', today).execute();
    let disabled = 0; let removed = 0;
    for (const row of rows) {
      if (row.status === 'unknown' || row.status === 'empty' || row.status === 'disabled') continue;
      if (row.expire_remove) {
        const executor = await this.executor(row.workspace_id);
        if (executor) { try { await this.release(row.workspace_id, row.id, executor, false); removed += 1; continue; } catch { /* keep record and disable */ } }
      }
      await this.db.updateTable('seat_slots').set({ status: 'disabled' }).where('id', '=', row.id).execute(); disabled += 1;
    }
    return { checked: rows.length, reminders:reminders.length, schedules: dueSchedules.length, disabled, removed };
  }
  private async notificationSchedules() { const rows=await this.db.selectFrom('notification_policies').select(['kind','configuration']).where('enabled','=',true).execute();return rows.map(row=>{const config=row.configuration;return{kind:row.kind,advanceDays:Number.isInteger(Number(config.advanceDays))?Number(config.advanceDays):7,triggerTime:typeof config.triggerTime==='string'?config.triggerTime:'09:00',timeZone:typeof config.timeZone==='string'?config.timeZone:'Asia/Shanghai'};}); }
  private async require(workspaceId: string, id: string) { const row = await this.db.selectFrom('seat_slots').selectAll().where('id', '=', id).where('workspace_id', '=', workspaceId).executeTakeFirst(); if (!row) throw new ServiceError(404, '客户席位不存在'); return row; }
  private async assertWorkspace(id: string) { if (!await this.db.selectFrom('workspaces').select('id').where('id', '=', id).executeTakeFirst()) throw new ServiceError(404, 'Workspace 不存在'); }
  private log(id: string, previous: string | null, next: string | null, reason: string) { return this.db.insertInto('seat_slot_identity_history').values({ seat_slot_id: id, previous_email: previous, next_email: next, changed_at: new Date(), reason }).execute(); }
  private activity(workspaceId:string,kind:string,payload:Record<string,unknown>){return this.#activity.log({workspaceId,kind,payload});}
  private async executor(workspaceId: string) { return (await this.db.selectFrom('workspace_memberships').select('account_id').where('workspace_id', '=', workspaceId).where('status', '=', 'active').where('normalized_role', 'in', ['owner', 'admin']).where('account_id', 'is not', null).executeTakeFirst())?.account_id ?? undefined; }
}

export function notificationScheduleDue(schedule:{triggerTime:string;timeZone:string},now:Date):boolean{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const hour=parts.find(item=>item.type==='hour')?.value??'00';const minute=parts.find(item=>item.type==='minute')?.value??'00';return `${hour}:${minute}`===schedule.triggerTime;}
function dateInTimeZone(now:Date,timeZone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return `${parts.find(item=>item.type==='year')?.value}-${parts.find(item=>item.type==='month')?.value}-${parts.find(item=>item.type==='day')?.value}`;}

export function startSeatExpirationScheduler(service: SeatSlotService, intervalMs = 60_000): () => void {
  const tick = () => void service.runExpirations().catch((error) => console.warn('[team-manager] 席位到期任务失败:', error));
  tick(); const timer = setInterval(tick, intervalMs); timer.unref(); return () => clearInterval(timer);
}
