import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { TeamOrderRepository } from '../repositories/teamOrderRepository.js';
import { ServiceError } from '../serviceError.js';
import type { TeamCodeGateway } from '../teamCodeClient.js';

const CYCLE_MS = 8 * 60 * 60_000; const RETRY = [60_000, 3 * 60_000, 10 * 60_000];
const DEFAULT_TEAM_ORDER_SEAT_QUANTITY = 2;
export class TeamOrderService {
  readonly #repo: TeamOrderRepository;
  constructor(private readonly db: Kysely<Database>, private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository, private readonly gateway: TeamCodeGateway) { this.#repo = new TeamOrderRepository(db); }

  async recover() { await this.db.updateTable('team_upgrade_orders').set({ status: 'queued', retry_at: new Date(), error_message: '进程重启后恢复' }).where('status', '=', 'running').execute(); }
  async run(input: { workspaceId?: string; all?: boolean; source?: string } = {}) {
    if (!this.gateway.configured) throw new ServiceError(503, 'TeamCode 服务尚未配置，无法生成订单');
    const q = this.db.selectFrom('team_order_maintenances').selectAll().where('enabled', '=', true);
    const rows = input.workspaceId ? await q.where('workspace_id', '=', input.workspaceId).execute() : await q.execute();
    let queued = 0; for (const row of rows) { if (await this.hasPending(row.workspace_id)) continue; await this.enqueue(row, input.source ?? (input.all ? 'manual_all' : 'manual')); queued += 1; }
    return { queued, skipped: rows.length - queued };
  }
  async control(workspaceId: string, action: 'pause' | 'resume' | 'run' | 'delete') {
    if (action === 'run') return this.run({ workspaceId });
    if (action === 'delete') { if (await this.hasRunning(workspaceId)) throw new ServiceError(409, '存在运行中订单'); await this.db.deleteFrom('team_order_maintenances').where('workspace_id','=',workspaceId).execute(); return true; }
    await this.db.updateTable('team_order_maintenances').set({ enabled: action === 'resume', pause_reason: action === 'pause' ? '手动暂停' : null, next_run_at: action === 'resume' ? new Date() : null }).where('workspace_id','=',workspaceId).execute(); return true;
  }
  async retry(orderId: string) { if(!this.gateway.configured) throw new ServiceError(503,'TeamCode 服务尚未配置，无法重试订单'); const row=await this.db.selectFrom('team_upgrade_orders').selectAll().where('id','=',orderId).executeTakeFirst(); if(!row) throw new ServiceError(404,'订单不存在'); await this.db.updateTable('team_upgrade_orders').set({status:'queued',retry_at:new Date(),scheduled_for:new Date(),error_message:null}).where('id','=',orderId).execute(); return true; }
  async removeOrder(orderId: string) { const row=await this.db.selectFrom('team_upgrade_orders').selectAll().where('id','=',orderId).executeTakeFirst(); if(!row) throw new ServiceError(404,'订单不存在'); if(row.status==='running') throw new ServiceError(409,'运行中订单不能删除'); await this.db.deleteFrom('team_upgrade_orders').where('id','=',orderId).execute(); return true; }

  async tick(now = new Date()) {
    if (!this.gateway.configured) return { maintenances: 0, orders: 0, skipped: 'teamcode_unconfigured' as const };
    const dueMaintenances = await this.db.selectFrom('team_order_maintenances').selectAll().where('enabled','=',true).where((eb)=>eb.or([eb('next_run_at','is',null),eb('next_run_at','<=',now)])).execute();
    for(const row of dueMaintenances){ if(!await this.hasPending(row.workspace_id)){ await this.enqueue(row,'scheduled'); await this.db.updateTable('team_order_maintenances').set({next_run_at:new Date(now.getTime()+CYCLE_MS)}).where('id','=',row.id).execute(); } }
    const orders=await this.db.selectFrom('team_upgrade_orders').selectAll().where('status','=','queued').where((eb)=>eb.or([eb('retry_at','is',null),eb('retry_at','<=',now)])).where((eb)=>eb.or([eb('scheduled_for','is',null),eb('scheduled_for','<=',now)])).orderBy('created_at').limit(3).execute();
    for(const order of orders) await this.execute(order.id);
    return { maintenances:dueMaintenances.length,orders:orders.length };
  }
  private async enqueue(row:any,source:string){ const config=await this.config(row); const scheduled=teamOrderScheduledFor(source,row.workspace_id); return this.#repo.saveOrder({workspaceId:row.workspace_id,executorAccountId:row.executor_account_id,status:'queued',configuration:config,source,scheduledFor:scheduled}); }
  private async execute(id:string){ const order=await this.db.selectFrom('team_upgrade_orders').selectAll().where('id','=',id).executeTakeFirstOrThrow(); const attempt=order.attempt_count+1; await this.db.updateTable('team_upgrade_orders').set({status:'running',attempt_count:attempt,retry_at:null}).where('id','=',id).execute();
    try { if(!this.gateway.configured) throw new Error('TeamCode 服务尚未配置'); const workspace=await this.db.selectFrom('workspaces').selectAll().where('id','=',order.workspace_id).executeTakeFirstOrThrow(); const account=await this.db.selectFrom('accounts').selectAll().where('id','=',order.executor_account_id).executeTakeFirstOrThrow(); const token=await this.sessions.accessToken(account.id,{kind:'workspace',workspaceId:workspace.id}); const session=await this.sessions.currentSession(account.id) as any; if(!token) throw new Error('执行账号缺少 Workspace Access Token'); const result=await this.gateway.generateOrder({account:{email:account.email,accountId:workspace.external_id,accessToken:token,...(session?.sessionToken?{sessionToken:session.sessionToken}:{})},targetWorkspaceId:workspace.external_id,workspaceName:workspace.name??'Workspace',config:order.configuration_snapshot as any}); const completed=new Date(); await this.db.updateTable('team_upgrade_orders').set({status:'ready',task_id:result.taskId,checkout_url:result.payUrl,stripe_created_at:new Date(result.stripeCreatedAt),expires_at:new Date(result.expiresAt),completed_at:completed,error_message:null}).where('id','=',id).execute(); await this.db.updateTable('team_order_maintenances').set({last_run_at:completed,last_success_at:completed,last_error:null}).where('workspace_id','=',workspace.id).execute(); }
    catch(error){const message=error instanceof Error?error.message:String(error); const delay=RETRY[attempt-1]; await this.db.updateTable('team_upgrade_orders').set({status:delay?'queued':'failed',retry_at:delay?new Date(Date.now()+delay):null,completed_at:delay?null:new Date(),error_message:message}).where('id','=',id).execute(); await this.db.updateTable('team_order_maintenances').set({last_run_at:new Date(),last_error:message}).where('workspace_id','=',order.workspace_id).execute();}}
  private async config(row:any){ const [specific,global,subscription]=await Promise.all([this.db.selectFrom('team_order_configurations').selectAll().where('workspace_id','=',row.workspace_id).executeTakeFirst(),this.db.selectFrom('team_order_configurations').selectAll().where('workspace_id','is',null).executeTakeFirst(),this.db.selectFrom('workspace_subscription_snapshots').select('fixed_seat_capacity').where('workspace_id','=',row.workspace_id).orderBy('observed_at','desc').orderBy('created_at','desc').executeTakeFirst()]); const seatQuantities=parseSeatQuantities(row.seat_quantities??specific?.seat_quantities??global?.seat_quantities); const seatQuantity=seatQuantities?.reduce((sum,item)=>sum+item.quantity,0)??row.seat_quantity??specific?.seat_quantity??global?.seat_quantity??subscription?.fixed_seat_capacity??DEFAULT_TEAM_ORDER_SEAT_QUANTITY; const config={promoCode:row.promo_code??specific?.promo_code??global?.promo_code??'',country:(row.country??specific?.country??global?.country??'').toUpperCase(),currency:(row.currency??specific?.currency??global?.currency??'').toUpperCase(),seatQuantity,...(seatQuantities?{seatQuantities}:{})}; if(!/^[A-Z]{2}$/.test(config.country)||!/^[A-Z]{3}$/.test(config.currency)||!Number.isSafeInteger(config.seatQuantity)||config.seatQuantity<0) throw new ServiceError(400,'订单国家、货币或席位数配置无效'); return config; }
  private hasPending(workspaceId:string){return this.db.selectFrom('team_upgrade_orders').select('id').where('workspace_id','=',workspaceId).where('status','in',['queued','running']).executeTakeFirst().then(Boolean);} private hasRunning(workspaceId:string){return this.db.selectFrom('team_upgrade_orders').select('id').where('workspace_id','=',workspaceId).where('status','=','running').executeTakeFirst().then(Boolean);}
}
function parseSeatQuantities(value: unknown): Array<{ seatType: 'default'|'usage_based'|'prolite'; quantity: number }> | undefined { const source=value&&typeof value==='object'&&!Array.isArray(value)?(value as any).items:value; if(!Array.isArray(source))return undefined; const rows=source.filter((item:any)=>item&&typeof item==='object'&&['default','usage_based','prolite'].includes(item.seatType)&&Number.isSafeInteger(Number(item.quantity))&&Number(item.quantity)>=0).map((item:any)=>({seatType:item.seatType,quantity:Number(item.quantity)})); return rows.length?rows:undefined; }
function stableOffset(key:string){return createHash('sha256').update(key).digest().readUInt32BE(0)%(10*60_000);}
export function teamOrderScheduledFor(source:string,workspaceId:string,now=new Date()){return new Date(now.getTime()+(source==='scheduled'?stableOffset(workspaceId):0));}
export function startTeamOrderScheduler(service:TeamOrderService,intervalMs=15_000){void service.recover().then(()=>service.tick());const timer=setInterval(()=>void service.tick().catch(e=>console.warn('[team-manager] Team 订单任务失败:',e)),intervalMs);timer.unref();return()=>clearInterval(timer);}
