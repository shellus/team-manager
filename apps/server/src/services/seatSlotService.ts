import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SeatSlotMutationInput, SeatType, WorkspaceInvitationMutationInput } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';
import { SeatSlotRepository } from '../repositories/seatSlotRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { WorkspaceOperationService } from './workspaceOperationService.js';
import type { NotificationService } from './notificationService.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';

export class SeatSlotService {
  readonly #repository: SeatSlotRepository;
  readonly #activity: ActivityLogRepository;
  readonly #workspaces: WorkspaceRepository;
  constructor(
    private readonly db: Kysely<Database>, private readonly workspaceOperations: WorkspaceOperationService,
    private readonly notifications?: NotificationService
  ) {
    this.#repository = new SeatSlotRepository(db);
    this.#activity = new ActivityLogRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async invite(workspaceId: string, executorAccountId: string, input: WorkspaceInvitationMutationInput) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    const existing = await this.db.selectFrom('seat_slots').selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('normalized_current_email', '=', normalizeEmail(input.email)).executeTakeFirst();
    if (existing && ['member', 'invited'].includes(existing.status)) throw new ServiceError(409, '该邮箱已有生效中的客户资料');
    await this.workspaceOperations.invite(workspaceId, executorAccountId, {
      email: input.email, seat: input.seat, role: input.role
    });
    const hasCustomerData = [input.contact, input.remark, input.price, input.expiresOn]
      .some((value) => typeof value === 'string' && value.trim()) || input.expireRemove === true;
    const customerInput: SeatSlotMutationInput = {
      email: input.email, seatType: input.seat, contact: input.contact, remark: input.remark,
      price: input.price, expiresOn: input.expiresOn, expireRemove: input.expireRemove
    };
    if (existing) await this.update(workspaceId, existing.id, executorAccountId,
      hasCustomerData ? customerInput : { email: input.email, seatType: input.seat });
    else if (hasCustomerData) await this.create(workspaceId, executorAccountId, customerInput);
  }

  async create(workspaceId: string, executorAccountId: string, input: SeatSlotMutationInput) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    const seatKey = input.seatKey?.trim() || randomBytes(24).toString('base64url');
    await this.assertWorkspace(workspaceId);
    if(input.remoteUserId!==undefined||input.status!==undefined)throw new ServiceError(400,'客户席位关系状态不能手工指定，请使用邀请、换号或释放操作');
    const relation=await this.relation(workspaceId,input.email);
    const seatType=relation.seatType??input.seatType;
    if (!['default', 'usage_based'].includes(seatType ?? '')) throw new ServiceError(400, '缺少有效席位类型');
    if (input.email) {
      const duplicate = await this.db.selectFrom('seat_slots').select('id').where('workspace_id', '=', workspaceId)
        .where('normalized_current_email', '=', normalizeEmail(input.email)).executeTakeFirst();
      if (duplicate) throw new ServiceError(409, '该成员或邀请已有客户资料');
    }
    const row = await this.#repository.save({ workspaceId, seatKey, email: input.email, remoteUserId: relation.remoteUserId,
      contact: input.contact, remark: input.remark, price: input.price, expiresOn: input.expiresOn,
      expireRemove: input.expireRemove,
      seatType: seatType!, status: relation.status });
    await this.log(row.id, null, row.current_email, 'created');await this.activity(workspaceId,'seat_slot_created',{seatSlotId:row.id,email:row.current_email,seatType:row.seat_type}); return row;
  }

  async update(workspaceId: string, id: string, executorAccountId: string, input: SeatSlotMutationInput) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    const row = await this.require(workspaceId, id);
    if(input.email!==undefined&&normalizeEmail(input.email??'')!==normalizeEmail(row.current_email??''))throw new ServiceError(400,'当前邮箱不能在资料编辑中修改，请先释放占用');
    if(input.remoteUserId!==undefined||input.status!==undefined)throw new ServiceError(400,'客户席位关系状态不能手工修改，请使用邀请、成员管理或释放操作');
    const relation=await this.relation(workspaceId,row.current_email);
    const updated = await this.#repository.save({ workspaceId, seatKey: row.seat_key, email:row.current_email,
      remoteUserId: relation.remoteUserId,
      contact: input.contact === undefined ? row.contact : input.contact, remark: input.remark === undefined ? row.remark : input.remark,
      price: input.price === undefined ? row.price : input.price, expiresOn: input.expiresOn === undefined ? row.expires_on : input.expiresOn,
      expireRemove: input.expireRemove ?? row.expire_remove,
      seatType: relation.seatType ?? input.seatType ?? row.seat_type as SeatType,
      status: relation.status === 'unknown' && row.status === 'disabled' ? 'disabled' : relation.status });
    await this.activity(workspaceId,'seat_slot_updated',{seatSlotId:id,email:updated.current_email,status:updated.status,seatType:updated.seat_type});
    return updated;
  }

  async remove(workspaceId: string, id: string, executorAccountId: string) { await this.requireManageableBy(workspaceId, executorAccountId);const row = await this.require(workspaceId, id); if (['member', 'invited'].includes(row.status)) throw new ServiceError(409, '占用中的席位不能删除，请先释放'); await this.db.deleteFrom('seat_slots').where('id', '=', id).execute();await this.activity(workspaceId,'seat_slot_removed',{seatSlotId:id}); return true; }
  async release(workspaceId: string, id: string, executorAccountId: string, force = false) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    const row = await this.require(workspaceId, id);
    const relation = await this.relation(workspaceId, row.current_email);
    if (relation.status === 'member' && relation.remoteUserId && !force) await this.workspaceOperations.removeMember(workspaceId, executorAccountId, relation.remoteUserId);
    else if (relation.status === 'invited' && row.current_email && !force) await this.workspaceOperations.revokeInvitation(workspaceId, executorAccountId, row.current_email);
    await this.log(id, row.current_email, null, force ? 'force_release' : 'release');
    const released=await this.db.updateTable('seat_slots').set({ current_email: null, normalized_current_email: null, remote_user_id: null, status: 'empty' }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();await this.#activity.log({accountId:executorAccountId,workspaceId,kind:'seat_slot_released',payload:{seatSlotId:id,previousEmail:row.current_email,force}});return released;
  }
  async runExpirations(now = new Date()) {
    const today = dateInTimeZone(now, 'UTC'); const schedules = await this.notificationSchedules();
    const dueSchedules = schedules.filter((schedule) => !schedule.hasExplicitSchedule || notificationScheduleDue(schedule, now));
    const seatSchedules = dueSchedules.filter((schedule) => schedule.kind !== 'workspace_renewal');
    const seatWindows=seatSchedules.map(schedule=>({schedule,start:dateInTimeZone(now,schedule.timeZone),end:addCalendarDays(dateInTimeZone(now,schedule.timeZone),schedule.advanceDays)}));
    const reminderStart=seatWindows.map(item=>item.start).sort()[0]??today;const reminderEnd=seatWindows.map(item=>item.end).sort().at(-1)??today;
    const reminders=await this.db.selectFrom('seat_slots').selectAll()
      .where('status','!=','disabled').where('current_email','is not',null)
      .where('expires_on','is not',null)
      .where('expires_on','>=',reminderStart).where('expires_on','<=',reminderEnd).execute();
    let seatReminders = 0;
    for (const {schedule,start,end} of seatWindows) {
      const reminderKey=`seat-expiry-reminder:${schedule.kind}:${dateInTimeZone(now,schedule.timeZone)}`;const already=await this.db.selectFrom('system_settings').select('key').where('key','=',reminderKey).executeTakeFirst();
      const matching=reminders.filter(row=>{const expiresOn=dateOnly(row.expires_on!);return expiresOn>=start&&expiresOn<=end;});
      if(matching.length&&!already){await this.notifications?.notifySeatExpiry(matching.map(row=>({seatSlotId:row.id,email:row.current_email,expiresOn:row.expires_on,workspaceId:row.workspace_id})),schedule.kind);await this.db.insertInto('system_settings').values({key:reminderKey,value:{count:matching.length,runAt:now.toISOString()},is_secret:false,ciphertext:null,nonce:null,auth_tag:null,key_version:null}).onConflict(oc=>oc.column('key').doNothing()).execute();seatReminders+=matching.length;}
    }
    const renewalSchedules = dueSchedules.filter((schedule) => schedule.kind === 'workspace_renewal');
    const renewalRows = renewalSchedules.length ? await this.db.selectFrom('workspaces').select(['id','external_id','name','normalized_plan','next_renewal_at'])
      .where('status','=','active').where('next_renewal_at','is not',null).execute() : [];
    let renewalReminders = 0;
    for (const schedule of renewalSchedules) {
      const localToday=dateInTimeZone(now,schedule.timeZone);const localEnd=addCalendarDays(localToday,schedule.advanceDays);
      const matching=renewalRows.filter(row=>{const date=dateInTimeZone(new Date(row.next_renewal_at as Date),schedule.timeZone);return date>=localToday&&date<=localEnd;});
      const reminderKey=`workspace-renewal-reminder:${schedule.kind}:${localToday}`;const already=await this.db.selectFrom('system_settings').select('key').where('key','=',reminderKey).executeTakeFirst();
      if(matching.length&&!already){await this.notifications?.notifyWorkspaceRenewal(matching.map(row=>({workspaceId:row.id,externalId:row.external_id,name:row.name,plan:row.normalized_plan,nextRenewalAt:new Date(row.next_renewal_at as Date).toISOString()})),schedule.kind);await this.db.insertInto('system_settings').values({key:reminderKey,value:{count:matching.length,runAt:now.toISOString()},is_secret:false,ciphertext:null,nonce:null,auth_tag:null,key_version:null}).onConflict(oc=>oc.column('key').doNothing()).execute();renewalReminders+=matching.length;}
    }
    const rows = await this.db.selectFrom('seat_slots').selectAll().where('expires_on', '<', today).execute();
    let disabled = 0; let removed = 0;
    for (const row of rows) {
      if (row.status === 'empty' || row.status === 'disabled') continue;
      if (row.expire_remove && ['member','invited'].includes(row.status)) {
        const executor = await this.executor(row.workspace_id);
        if (executor) { try { await this.release(row.workspace_id, row.id, executor, false); removed += 1; continue; } catch { /* keep record and disable */ } }
      }
      await this.db.updateTable('seat_slots').set({ status: 'disabled' }).where('id', '=', row.id).execute(); disabled += 1;
    }
    return { checked: rows.length, reminders:seatReminders, renewalReminders, schedules: dueSchedules.length, disabled, removed };
  }
  private async notificationSchedules() { const rows=await this.db.selectFrom('notification_policies').select(['kind','configuration']).where('enabled','=',true).where('kind','in',['seat_expiration','workspace_renewal']).execute();return rows.map(row=>{const config=row.configuration;return{kind:row.kind,advanceDays:Number.isInteger(Number(config.advanceDays))?Number(config.advanceDays):7,triggerTime:typeof config.triggerTime==='string'?config.triggerTime:'09:00',timeZone:typeof config.timeZone==='string'?config.timeZone:'Asia/Shanghai',hasExplicitSchedule:typeof config.triggerTime==='string'&&typeof config.timeZone==='string'};}); }
  private async require(workspaceId: string, id: string) { const row = await this.db.selectFrom('seat_slots').selectAll().where('id', '=', id).where('workspace_id', '=', workspaceId).executeTakeFirst(); if (!row) throw new ServiceError(404, '客户席位不存在'); return row; }
  private async requireManageableBy(workspaceId:string,accountId:string){try{await this.#workspaces.requireManageableBy(workspaceId,accountId);}catch(error){throw asServiceError(error);}}
  private async assertWorkspace(id: string) { if (!await this.db.selectFrom('workspaces').select('id').where('id', '=', id).executeTakeFirst()) throw new ServiceError(404, 'Workspace 不存在'); }
  private async relation(workspaceId:string,email:string|null|undefined):Promise<{status:'empty'|'member'|'invited'|'unknown';remoteUserId:null|string;seatType?:SeatType}>{
    if(!email)return{status:'empty',remoteUserId:null};
    const normalized=normalizeEmail(email);
    const members=await this.db.selectFrom('workspace_memberships').select(['remote_user_id','seat_type']).where('workspace_id','=',workspaceId).where('normalized_email','=',normalized).where('status','=','active').execute();
    const member=members.find(row=>Boolean(row.remote_user_id))??members[0];
    if(member)return{status:'member',remoteUserId:member.remote_user_id,seatType:member.seat_type as SeatType|undefined};
    const invitation=await this.db.selectFrom('workspace_invitations').select('seat_type').where('workspace_id','=',workspaceId).where('normalized_email','=',normalized).where('status','=','pending').executeTakeFirst();
    if(invitation)return{status:'invited',remoteUserId:null,seatType:invitation.seat_type as SeatType|undefined};
    return{status:'unknown',remoteUserId:null};
  }
  private log(id: string, previous: string | null, next: string | null, reason: string) { return this.db.insertInto('seat_slot_identity_history').values({ seat_slot_id: id, previous_email: previous, next_email: next, changed_at: new Date(), reason }).execute(); }
  private activity(workspaceId:string,kind:string,payload:Record<string,unknown>){return this.#activity.log({workspaceId,kind,payload});}
  private async executor(workspaceId: string) { return (await this.db.selectFrom('workspace_memberships').select('account_id').where('workspace_id', '=', workspaceId).where('status', '=', 'active').where('normalized_role', 'in', ['owner', 'admin']).where('account_id', 'is not', null).executeTakeFirst())?.account_id ?? undefined; }
}

export function notificationScheduleDue(schedule:{triggerTime:string;timeZone:string;hasExplicitSchedule?:boolean},now:Date):boolean{if(schedule.hasExplicitSchedule===false)return true;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const hour=parts.find(item=>item.type==='hour')?.value??'00';const minute=parts.find(item=>item.type==='minute')?.value??'00';return `${hour}:${minute}`===schedule.triggerTime;}
function dateInTimeZone(now:Date,timeZone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return `${parts.find(item=>item.type==='year')?.value}-${parts.find(item=>item.type==='month')?.value}-${parts.find(item=>item.type==='day')?.value}`;}
function dateOnly(value:string|Date){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}
function addCalendarDays(value:string,days:number){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}

export function startSeatExpirationScheduler(service: SeatSlotService, intervalMs = 60_000): () => void {
  const tick = () => void service.runExpirations().catch((error) => console.warn('[team-manager] 席位到期任务失败:', error));
  tick(); const timer = setInterval(tick, intervalMs); timer.unref(); return () => clearInterval(timer);
}
