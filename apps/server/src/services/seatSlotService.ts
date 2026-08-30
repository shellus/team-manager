import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { isSeatType, type SeatSlotMutationInput, type SeatType, type WorkspaceInvitationMutationInput } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';
import { SeatSlotRepository } from '../repositories/seatSlotRepository.js';
import { SeatSlotRelationRepository } from '../repositories/seatSlotRelationRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { WorkspaceOperationService } from './workspaceOperationService.js';
import type { NotificationService } from './notificationService.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { LIMITED_MAX_ATTEMPTS, limitedRetryDelay } from '../retryPolicy.js';
import { addCalendarDays, calendarDateInTimeZone, seatExpirationBusinessDate } from '../domain/businessDate.js';

const REMOVAL_CLAIM_TIMEOUT_MS = 15 * 60_000;

export class SeatSlotService {
  readonly #repository: SeatSlotRepository;
  readonly #relations: SeatSlotRelationRepository;
  readonly #activity: ActivityLogRepository;
  readonly #workspaces: WorkspaceRepository;
  constructor(
    private readonly db: Kysely<Database>, private readonly workspaceOperations: WorkspaceOperationService,
    private readonly notifications?: NotificationService
  ) {
    this.#repository = new SeatSlotRepository(db);
    this.#relations = new SeatSlotRelationRepository(db);
    this.#activity = new ActivityLogRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async invite(workspaceId: string, executorAccountId: string, input: WorkspaceInvitationMutationInput) {
    const existing = await this.db.selectFrom('seat_slots').selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('normalized_current_email', '=', normalizeEmail(input.email)).executeTakeFirst();
    const existingRelation = existing ? await this.#relations.resolve(existing.workspace_id, existing.current_email) : undefined;
    if (existingRelation && ['member', 'invited'].includes(existingRelation.status)) throw new ServiceError(409, '该邮箱已有生效中的客户资料');
    await this.workspaceOperations.invite(workspaceId, executorAccountId, {
      email: input.email, seat: input.seat, role: input.role
    });
    const hasCustomerData = [input.contact, input.remark, input.price, input.expiresOn]
      .some((value) => typeof value === 'string' && value.trim()) || input.expireRemove === true;
    const customerInput: SeatSlotMutationInput = {
      email: input.email, seatType: input.seat, contact: input.contact, remark: input.remark,
      price: input.price, expiresOn: input.expiresOn, expireReminder: input.expireReminder,
      expireRemove: input.expireRemove
    };
    if (existing) await this.updateRecord(workspaceId, existing.id,
      hasCustomerData ? customerInput : { email: input.email, ...(input.seat ? { seatType: input.seat } : {}) });
    else if (hasCustomerData) await this.createRecord(workspaceId, customerInput);
  }

  async create(workspaceId: string, executorAccountId: string, input: SeatSlotMutationInput) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    return this.createRecord(workspaceId, input);
  }

  private async createRecord(workspaceId: string, input: SeatSlotMutationInput) {
    const email = input.email?.trim();
    if (!email || !normalizeEmail(email).includes('@')) throw new ServiceError(400, '缺少有效关联邮箱');
    const seatKey = input.seatKey?.trim() || randomBytes(24).toString('base64url');
    await this.assertWorkspace(workspaceId);
    if((input as Record<string,unknown>).remoteUserId!==undefined||(input as Record<string,unknown>).status!==undefined)throw new ServiceError(400,'客户席位关系状态不能手工指定，请使用邀请、换号或释放操作');
    const relation=await this.#relations.resolve(workspaceId,email);
    const seatType=relation.seatType??input.seatType;
    if (seatType !== undefined && !isSeatType(seatType)) throw new ServiceError(400, '无效席位类型');
    const duplicate = await this.db.selectFrom('seat_slots').select('id').where('workspace_id', '=', workspaceId)
      .where('normalized_current_email', '=', normalizeEmail(email)).executeTakeFirst();
    if (duplicate) throw new ServiceError(409, '该成员或邀请已有客户资料');
    const row = await this.#repository.save({ workspaceId, seatKey, email,
      contact: input.contact, remark: input.remark, price: input.price, expiresOn: input.expiresOn,
      expireReminder: input.expireReminder,
      expireRemove: input.expireRemove,
      seatType });
    await this.log(row.id, null, row.current_email, 'created');await this.activity(workspaceId,'seat_slot_created',{seatSlotId:row.id,email:row.current_email,seatType:row.seat_type}); return row;
  }

  async update(workspaceId: string, id: string, executorAccountId: string, input: SeatSlotMutationInput) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    return this.updateRecord(workspaceId, id, input);
  }

  private async updateRecord(workspaceId: string, id: string, input: SeatSlotMutationInput) {
    const row = await this.require(workspaceId, id);
    if(input.email!==undefined&&normalizeEmail(input.email??'')!==normalizeEmail(row.current_email??''))throw new ServiceError(400,'当前邮箱不能在资料编辑中修改，请先释放占用');
    if((input as Record<string,unknown>).remoteUserId!==undefined||(input as Record<string,unknown>).status!==undefined)throw new ServiceError(400,'客户席位关系状态不能手工修改，请使用邀请、成员管理或释放操作');
    const relation=await this.#relations.resolve(workspaceId,row.current_email);
    const nextExpiresOn = input.expiresOn === undefined ? row.expires_on : input.expiresOn;
    const nextExpireReminder = input.expireReminder ?? row.expire_reminder;
    const nextExpireRemove = input.expireRemove ?? row.expire_remove;
    const removalPolicyChanged = nextExpiresOn !== row.expires_on || nextExpireRemove !== row.expire_remove;
    const updated = await this.#repository.save({ workspaceId, seatKey: row.seat_key, email:row.current_email,
      contact: input.contact === undefined ? row.contact : input.contact, remark: input.remark === undefined ? row.remark : input.remark,
      price: input.price === undefined ? row.price : input.price, expiresOn: nextExpiresOn,
      expireReminder: nextExpireReminder,
      expireRemove: nextExpireRemove,
      seatType: relation.seatType ?? input.seatType ?? row.seat_type as SeatType });
    if (removalPolicyChanged) await this.db.deleteFrom('seat_expiration_removal_attempts').where('seat_slot_id', '=', id).execute();
    const before=seatAuditState(row);const after=seatAuditState(updated);const changedFields=Object.keys(after).filter(key=>before[key]!==after[key]);
    await this.activity(workspaceId,'seat_slot_updated',{seatSlotId:id,email:updated.current_email,relationStatus:relation.status,seatType:updated.seat_type,changedFields,before,after});
    return updated;
  }

  async remove(workspaceId: string, id: string, executorAccountId: string) { await this.requireManageableBy(workspaceId, executorAccountId);const row = await this.require(workspaceId, id); const relation=await this.#relations.resolve(workspaceId,row.current_email);if (['member', 'invited'].includes(relation.status)) throw new ServiceError(409, '占用中的席位不能删除，请先释放'); await this.db.deleteFrom('seat_slots').where('id', '=', id).execute();await this.activity(workspaceId,'seat_slot_removed',{seatSlotId:id}); return true; }
  async release(workspaceId: string, id: string, executorAccountId: string, force = false) {
    await this.requireManageableBy(workspaceId, executorAccountId);
    const row = await this.require(workspaceId, id);
    const relation = await this.#relations.resolve(workspaceId, row.current_email);
    if (relation.status === 'member' && relation.remoteUserId && !force) await this.workspaceOperations.removeMember(workspaceId, executorAccountId, relation.remoteUserId);
    else if (relation.status === 'invited' && row.current_email && !force) await this.workspaceOperations.revokeInvitation(workspaceId, executorAccountId, row.current_email);
    await this.db.deleteFrom('seat_slots').where('id', '=', id).execute();
    await this.#activity.log({accountId:executorAccountId,workspaceId,kind:'seat_slot_released',payload:{seatSlotId:id,previousEmail:row.current_email,force,localProfileDeleted:true}});
    return true;
  }
  async runExpirations(now = new Date()) {
    const today = seatExpirationBusinessDate(now); const schedules = await this.notificationSchedules();
    const dueSchedules = schedules.filter((schedule) => !schedule.hasExplicitSchedule || notificationScheduleDue(schedule, now));
    const seatSchedules = dueSchedules.filter((schedule) => schedule.kind !== 'workspace_renewal');
    const seatWindows=seatSchedules.map(schedule=>({schedule,start:calendarDateInTimeZone(now,schedule.timeZone),end:addCalendarDays(calendarDateInTimeZone(now,schedule.timeZone),schedule.advanceDays)}));
    const reminderStart=seatWindows.map(item=>item.start).sort()[0]??today;const reminderEnd=seatWindows.map(item=>item.end).sort().at(-1)??today;
    const reminders=await this.db.selectFrom('seat_slots').selectAll()
      .where('expire_reminder','=',true)
      .where('expires_on','is not',null)
      .where('expires_on','>=',reminderStart).where('expires_on','<=',reminderEnd).execute();
    const reminderWorkspaceIds=[...new Set(reminders.map(row=>row.workspace_id))];
    const reminderWorkspaces=reminderWorkspaceIds.length?await this.db.selectFrom('workspaces').select(['id','name','external_id']).where('id','in',reminderWorkspaceIds).execute():[];
    const reminderWorkspaceById=new Map(reminderWorkspaces.map(row=>[row.id,row]));
    let seatReminders = 0;
    for (const {schedule,start,end} of seatWindows) {
      const reminderKey=`seat-expiry-reminder:${schedule.kind}:${calendarDateInTimeZone(now,schedule.timeZone)}`;const already=await this.db.selectFrom('system_settings').select('key').where('key','=',reminderKey).executeTakeFirst();
      const matching=reminders.filter(row=>{const expiresOn=dateOnly(row.expires_on!);return expiresOn>=start&&expiresOn<=end;});
      if(matching.length&&!already){await this.notifications?.notifySeatExpiry(matching.map(row=>{const workspace=reminderWorkspaceById.get(row.workspace_id);return{seatSlotId:row.id,...(row.current_email?{email:row.current_email}:{relationStatus:'unclaimed' as const}),expiresOn:dateOnly(row.expires_on!),expireRemove:row.expire_remove,workspaceId:row.workspace_id,...(workspace?.name?{workspaceName:workspace.name}:{}),...(workspace?.external_id?{workspaceExternalId:workspace.external_id}:{})};}),schedule.kind,{observedAt:now.toISOString(),timeZone:schedule.timeZone,windowStart:start,windowEnd:end});await this.db.insertInto('system_settings').values({key:reminderKey,value:{count:matching.length,runAt:now.toISOString()},is_secret:false,ciphertext:null,nonce:null,auth_tag:null,key_version:null}).onConflict(oc=>oc.column('key').doNothing()).execute();seatReminders+=matching.length;}
    }
    const renewalSchedules = dueSchedules.filter((schedule) => schedule.kind === 'workspace_renewal');
    const renewalRows = renewalSchedules.length ? await this.db.selectFrom('workspaces').select(['id','external_id','name','normalized_plan','next_renewal_at'])
      .where('status','=','active').where('next_renewal_at','is not',null).execute() : [];
    let renewalReminders = 0;
    for (const schedule of renewalSchedules) {
      const localToday=calendarDateInTimeZone(now,schedule.timeZone);const localEnd=addCalendarDays(localToday,schedule.advanceDays);
      const matching=renewalRows.filter(row=>{const date=calendarDateInTimeZone(new Date(row.next_renewal_at as Date),schedule.timeZone);return date>=localToday&&date<=localEnd;});
      const reminderKey=`workspace-renewal-reminder:${schedule.kind}:${localToday}`;const already=await this.db.selectFrom('system_settings').select('key').where('key','=',reminderKey).executeTakeFirst();
      if(matching.length&&!already){await this.notifications?.notifyWorkspaceRenewal(matching.map(row=>({workspaceId:row.id,externalId:row.external_id,...(row.name?{name:row.name}:{}),plan:row.normalized_plan,nextRenewalAt:new Date(row.next_renewal_at as Date).toISOString()})),schedule.kind,{observedAt:now.toISOString(),timeZone:schedule.timeZone,windowStart:localToday,windowEnd:localEnd});await this.db.insertInto('system_settings').values({key:reminderKey,value:{count:matching.length,runAt:now.toISOString()},is_secret:false,ciphertext:null,nonce:null,auth_tag:null,key_version:null}).onConflict(oc=>oc.column('key').doNothing()).execute();renewalReminders+=matching.length;}
    }
    const rows = await this.db.selectFrom('seat_slots as slot')
      .leftJoin('seat_expiration_removal_attempts as removal', 'removal.seat_slot_id', 'slot.id')
      .selectAll('slot').where('slot.expires_on', '<', today)
      .where((eb) => eb.or([
        eb('slot.expire_remove', '=', false),
        eb('removal.status', 'is', null),
        eb('removal.status', 'in', ['retrying', 'running'])
      ])).execute();
    let expiredWithoutRemoval = 0; let removed = 0; let removalRetrying = 0; let removalFailed = 0;
    for (const row of rows) {
      if (row.expire_remove) {
        const outcome = await this.attemptExpirationRemoval(row, now);
        if (outcome === 'removed') removed += 1;
        else if (outcome === 'retrying') removalRetrying += 1;
        else if (outcome === 'failed') removalFailed += 1;
        continue;
      }
      expiredWithoutRemoval += 1;
    }
    return { checked: rows.length, reminders:seatReminders, renewalReminders, schedules: dueSchedules.length, expiredWithoutRemoval, removed, removalRetrying, removalFailed };
  }
  private async attemptExpirationRemoval(row: {
    id:string;workspace_id:string;current_email:string|null;expires_on:string|null
  }, now:Date):Promise<'removed'|'retrying'|'failed'|'skipped'> {
    await this.db.insertInto('seat_expiration_removal_attempts').values({
      seat_slot_id:row.id,status:'retrying',attempt_count:0,next_attempt_at:now,last_attempt_at:null,last_error:null,failed_at:null,succeeded_at:null
    }).onConflict((oc)=>oc.column('seat_slot_id').doNothing()).execute();
    const claimed=await this.db.updateTable('seat_expiration_removal_attempts').set((eb)=>({
      status:'running',attempt_count:eb('attempt_count','+',1),last_attempt_at:now,
      next_attempt_at:new Date(now.getTime()+REMOVAL_CLAIM_TIMEOUT_MS),last_error:null
    })).where('seat_slot_id','=',row.id).where('status','in',['retrying','running'])
      .where('next_attempt_at','<=',now).where('attempt_count','<',LIMITED_MAX_ATTEMPTS)
      .returningAll().executeTakeFirst();
    if(!claimed)return'skipped';
    try{
      const executor=await this.executor(row.workspace_id);
      if(!executor)throw new Error('Workspace 缺少可执行自动移除的 owner/admin 账号');
      await this.workspaceOperations.refreshPeople(row.workspace_id,executor);
      const relation=await this.#relations.resolve(row.workspace_id,row.current_email);
      if(relation.status==='member'){
        if(!relation.remoteUserId)throw new Error('上游成员关系缺少远端用户 ID');
        await this.workspaceOperations.removeMember(row.workspace_id,executor,relation.remoteUserId);
      }else if(relation.status==='invited'&&row.current_email){
        await this.workspaceOperations.revokeInvitation(row.workspace_id,executor,row.current_email);
      }
      const remaining=await this.#relations.resolve(row.workspace_id,row.current_email);
      if(remaining.status==='member'||remaining.status==='invited')throw new Error(`上游关系仍为 ${remaining.status}`);
      await this.db.updateTable('seat_expiration_removal_attempts').set({
        status:'succeeded',next_attempt_at:null,last_error:null,failed_at:null,succeeded_at:now
      }).where('seat_slot_id','=',row.id).execute();
      await this.#activity.log({workspaceId:row.workspace_id,kind:'seat_slot_expiration_removal_succeeded',payload:{seatSlotId:row.id,email:row.current_email,expiresOn:row.expires_on,relationStatus:relation.status,alreadyAbsent:relation.status==='unclaimed'||relation.status==='unlinked',attemptCount:claimed.attempt_count}});
      return'removed';
    }catch(error){
      const message=expirationRemovalError(error);
      const delay=limitedRetryDelay(claimed.attempt_count);
      if(delay!==undefined&&claimed.attempt_count<LIMITED_MAX_ATTEMPTS){
        await this.db.updateTable('seat_expiration_removal_attempts').set({
          status:'retrying',next_attempt_at:new Date(now.getTime()+delay),last_error:message,failed_at:null
        }).where('seat_slot_id','=',row.id).execute();
        return'retrying';
      }
      await this.db.updateTable('seat_expiration_removal_attempts').set({
        status:'failed',next_attempt_at:null,last_error:message,failed_at:now
      }).where('seat_slot_id','=',row.id).execute();
      const workspace=await this.db.selectFrom('workspaces').select(['name','external_id']).where('id','=',row.workspace_id).executeTakeFirst();
      const relation=await this.#relations.resolve(row.workspace_id,row.current_email);
      const payload={seatSlotId:row.id,email:row.current_email,workspaceId:row.workspace_id,...(workspace?.name?{workspaceName:workspace.name}:{}),...(workspace?.external_id?{workspaceExternalId:workspace.external_id}:{}),expiresOn:row.expires_on,
        relationStatus:relation.status,error:message,attemptCount:claimed.attempt_count,maxAttempts:LIMITED_MAX_ATTEMPTS};
      await this.#activity.log({workspaceId:row.workspace_id,kind:'seat_slot_expiration_removal_failed',payload});
      try{await this.notifications?.notifySeatRemovalFailure(payload);}catch(notificationError){
        console.warn('[team-manager] 席位自动移除失败告警投递失败:',notificationError);
      }
      return'failed';
    }
  }
  private async notificationSchedules() { const rows=await this.db.selectFrom('notification_policies').select(['kind','configuration']).where('enabled','=',true).where('kind','in',['seat_expiration','workspace_renewal']).execute();return rows.map(row=>{const config=row.configuration;return{kind:row.kind,advanceDays:Number.isInteger(Number(config.advanceDays))?Number(config.advanceDays):7,triggerTime:typeof config.triggerTime==='string'?config.triggerTime:'09:00',timeZone:typeof config.timeZone==='string'?config.timeZone:'Asia/Shanghai',hasExplicitSchedule:typeof config.triggerTime==='string'&&typeof config.timeZone==='string'};}); }
  private async require(workspaceId: string, id: string) { const row = await this.db.selectFrom('seat_slots').selectAll().where('id', '=', id).where('workspace_id', '=', workspaceId).executeTakeFirst(); if (!row) throw new ServiceError(404, '客户席位不存在'); return row; }
  private async requireManageableBy(workspaceId:string,accountId:string){try{await this.#workspaces.requireManageableBy(workspaceId,accountId);}catch(error){throw asServiceError(error);}}
  private async assertWorkspace(id: string) { if (!await this.db.selectFrom('workspaces').select('id').where('id', '=', id).executeTakeFirst()) throw new ServiceError(404, 'Workspace 不存在'); }
  private log(id: string, previous: string | null, next: string | null, reason: string) { return this.db.insertInto('seat_slot_identity_history').values({ seat_slot_id: id, previous_email: previous, next_email: next, changed_at: new Date(), reason }).execute(); }
  private activity(workspaceId:string,kind:string,payload:Record<string,unknown>){return this.#activity.log({workspaceId,kind,payload});}
  private async executor(workspaceId: string) { return (await this.db.selectFrom('workspace_memberships').select('account_id').where('workspace_id', '=', workspaceId).where('status', '=', 'active').where('normalized_role', 'in', ['owner', 'admin']).where('account_id', 'is not', null).executeTakeFirst())?.account_id ?? undefined; }
}

export function notificationScheduleDue(schedule:{triggerTime:string;timeZone:string;hasExplicitSchedule?:boolean},now:Date):boolean{if(schedule.hasExplicitSchedule===false)return true;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const hour=parts.find(item=>item.type==='hour')?.value??'00';const minute=parts.find(item=>item.type==='minute')?.value??'00';return `${hour}:${minute}`>=schedule.triggerTime;}
function dateOnly(value:string|Date){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}
function expirationRemovalError(error:unknown){const message=error instanceof Error?error.message:String(error);return message.slice(0,2000)||'未知错误';}
function seatAuditState(row:{contact:string|null;remark:string|null;price:string|null;expires_on:string|null;expire_reminder:boolean;expire_remove:boolean;seat_type:string|null}){return{contact:row.contact,remark:row.remark,price:row.price,expiresOn:row.expires_on,expireReminder:row.expire_reminder,expireRemove:row.expire_remove,seatType:row.seat_type} as Record<string,unknown>;}

export function startSeatExpirationScheduler(service: SeatSlotService, intervalMs = 60_000): () => void {
  const tick = () => void service.runExpirations().catch((error) => console.warn('[team-manager] 席位到期任务失败:', error));
  tick(); const timer = setInterval(tick, intervalMs); timer.unref(); return () => clearInterval(timer);
}
