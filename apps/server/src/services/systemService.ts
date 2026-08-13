import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { TeamOrderRepository } from '../repositories/teamOrderRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError } from '../serviceError.js';
import type { NotificationPolicyConfiguration, NotificationPolicyView, SeatOperationalOverviewView, WorkspaceOperationalOverviewView } from '@team-manager/shared';

export class SystemService {
  readonly #orders: TeamOrderRepository;
  readonly #workspaces: WorkspaceRepository;
  constructor(private readonly db: Kysely<Database>, private readonly teamCodeConfigured = false) {
    this.#orders = new TeamOrderRepository(db);
    this.#workspaces = new WorkspaceRepository(db);
  }

  async teamOrders() {
    return this.#orders.dashboard(this.teamCodeConfigured);
  }

  saveTeamOrderConfiguration(input: { workspaceId?: string; promoCode?: string; country?: string; currency?: string }) {
    return this.#orders.saveConfiguration(input.workspaceId ?? null, input);
  }

  async saveMaintenance(input: { workspaceId: string; executorAccountId: string; enabled: boolean; promoCode?: string; country?: string; currency?: string }) {
    await this.#workspaces.requireManageableBy(input.workspaceId, input.executorAccountId);
    await this.#orders.saveMaintenance({
      workspaceId: input.workspaceId,
      executorAccountId: input.executorAccountId,
      enabled: input.enabled,
      overrides: input
    });
  }

  async notificationPolicies(): Promise<NotificationPolicyView[]> {
    const rows = await this.db.selectFrom('notification_policies').selectAll().orderBy('kind').execute();
    return rows.map((row) => ({ id: row.id, kind: row.kind, enabled: row.enabled,
      configuration: notificationConfiguration(row.configuration), updatedAt: iso(row.updated_at) }));
  }

  async saveNotificationPolicy(kind: string, input: { enabled?: boolean; configuration?: Record<string, unknown> }) {
    const normalized = kind.trim();
    if (!normalized) throw new ServiceError(400, '通知策略类型不能为空');
    const configuration = notificationConfiguration(input.configuration ?? {});
    validateNotificationConfiguration(configuration, input.enabled === true);
    const storedConfiguration = { ...configuration } as Record<string, unknown>;
    await this.db.insertInto('notification_policies').values({
      kind: normalized,
      enabled: input.enabled === true,
      configuration: storedConfiguration
    }).onConflict((oc) => oc.column('kind').doUpdateSet({ enabled: input.enabled === true, configuration: storedConfiguration })).execute();
    return this.notificationPolicies();
  }

  async overviewWorkspaces(): Promise<WorkspaceOperationalOverviewView[]> {
    const rows = await this.db.selectFrom('workspaces as w').selectAll('w').select((eb) => [
      eb.selectFrom('workspace_memberships as m').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('m.workspace_id', '=', 'w.id').where('m.status', '=', 'active').as('member_count'),
      eb.selectFrom('workspace_invitations as i').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('i.workspace_id', '=', 'w.id').where('i.status', '=', 'pending').as('invitation_count'),
      eb.selectFrom('seat_slots as s').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('s.workspace_id', '=', 'w.id').where('s.status', '!=', 'disabled').as('seat_slot_count'),
      eb.selectFrom('workspace_memberships as m').select(({ fn }) => fn.countAll<number>().as('count')).whereRef('m.workspace_id', '=', 'w.id').where('m.status', '=', 'active').where('m.seat_type', '=', 'default').as('fixed_occupied')
    ]).orderBy('w.updated_at', 'desc').execute();
    const billing = await latestWorkspaceBilling(this.db);
    return rows.map((row) => {
      const bill = billing.get(row.id); const nextRenewalAt = row.next_renewal_at ? iso(row.next_renewal_at) : undefined;
      const risks = workspaceRisks(row, nextRenewalAt); const fixedCapacity = row.normalized_plan === 'business' ? 2 : undefined;
      const occupied = Number(row.fixed_occupied);
      return { id: row.id, externalId: row.external_id, ...(row.name ? { name: row.name } : {}), status: row.status,
        plan: row.normalized_plan, ...(nextRenewalAt ? { nextRenewalAt } : {}), ...bill,
        ...(fixedCapacity === undefined ? {} : { fixedSeatCapacity: fixedCapacity, fixedSeatAvailable: Math.max(fixedCapacity - occupied, 0) }),
        fixedSeatOccupied: occupied, memberCount: Number(row.member_count), invitationCount: Number(row.invitation_count),
        seatSlotCount: Number(row.seat_slot_count), riskLevel: riskLevel(risks), risks };
    }).sort(compareWorkspaceRisk);
  }

  async overviewSeats(): Promise<SeatOperationalOverviewView[]> {
    const [workspaces, memberships, invitations, slots] = await Promise.all([
      this.db.selectFrom('workspaces').selectAll().where('status', '=', 'active').execute(),
      this.db.selectFrom('workspace_memberships').selectAll().where('status', '=', 'active').execute(),
      this.db.selectFrom('workspace_invitations').selectAll().where('status', '=', 'pending').execute(),
      this.db.selectFrom('seat_slots').selectAll().where('status', '!=', 'disabled').execute()
    ]);
    const byWorkspace = new Map(workspaces.map((row) => [row.id, row])); const combined = new Map<string,{workspace:any;email?:string;membership?:any;invitation?:any;slot?:any}>();
    const relation=(workspaceId:string,email:unknown,fallback:string)=>{const normalized=typeof email==='string'?email.trim().toLowerCase():'';const key=normalized?`${workspaceId}:email:${normalized}`:`${workspaceId}:${fallback}`;const current=combined.get(key)??{workspace:byWorkspace.get(workspaceId),...(normalized?{email:normalized}:{})};combined.set(key,current);return current;};
    for(const row of memberships){if(!byWorkspace.has(row.workspace_id))continue;relation(row.workspace_id,row.email??undefined,`membership:${row.id}`).membership=row;}
    for(const row of invitations){if(!byWorkspace.has(row.workspace_id))continue;relation(row.workspace_id,row.email,`invitation:${row.id}`).invitation=row;}
    for(const row of slots){if(!byWorkspace.has(row.workspace_id))continue;relation(row.workspace_id,row.current_email,`seat-slot:${row.id}`).slot=row;}
    const result: SeatOperationalOverviewView[]=[];
    for(const [key,row] of combined){if(!row.workspace)continue;const sources=[row.membership?'membership':undefined,row.invitation?'invitation':undefined,row.slot?'seat_slot':undefined].filter(Boolean) as Array<'membership'|'invitation'|'seat_slot'>;const primary=sources[0]!;const status=row.membership?.status??row.invitation?.status??row.slot?.status??'unknown';const role=row.membership?.normalized_role??row.invitation?.normalized_role;const risks:string[]=[];if(row.slot&&!row.membership&&!row.invitation&&row.slot.current_email)risks.push('客户席位与远端关系失联');if(row.slot&&row.membership&&row.slot.status!=='member')risks.push('客户席位本地状态与成员关系不一致');if(row.slot&&row.invitation&&!row.membership&&row.slot.status!=='invited')risks.push('客户席位本地状态与邀请关系不一致');const expiresOn=row.slot?.expires_on?dateKey(row.slot.expires_on):undefined;if(expiresOn&&expiresOn<new Date().toISOString().slice(0,10))risks.push('客户席位已到期');result.push({id:key,workspaceId:row.workspace.id,...(row.workspace.name?{workspaceName:row.workspace.name}:{}),workspaceExternalId:row.workspace.external_id,source:primary,sources,...(row.email?{email:row.email}:{}),...(row.membership?.display_name?{displayName:row.membership.display_name}:{}),...(role?{role}:{}),seatType:(row.membership?.seat_type??row.invitation?.seat_type??row.slot?.seat_type)==='usage_based'?'usage_based':'default',status,...(row.slot?.contact?{contact:row.slot.contact}:{}),...(row.slot?.remark?{remark:row.slot.remark}:{}),...(expiresOn?{expiresOn}:{}),...(row.slot?.price?{price:row.slot.price}:{}),riskLevel:risks.some(item=>item.includes('到期'))?'critical':risks.length?'warning':'normal',risks});}
    for (const workspace of workspaces.filter((item)=>item.normalized_plan==='business')) { const occupied=memberships.filter((item)=>item.workspace_id===workspace.id&&item.seat_type==='default').length;for(let i=occupied;i<2;i+=1)result.push(seatView(workspace,'fixed_vacancy',`${workspace.id}:fixed:${i}`, 'default','empty',{})); }
    return result.sort((a,b)=>riskRank(a.riskLevel)-riskRank(b.riskLevel)||dateKey(a.expiresOn).localeCompare(dateKey(b.expiresOn)));
  }
}

function notificationConfiguration(value: Record<string, unknown>): NotificationPolicyConfiguration {
  return { advanceDays: integer(value.advanceDays, 7), triggerTime: time(value.triggerTime), timeZone: text(value.timeZone) ?? 'Asia/Shanghai',
    webhookEnabled: enabled(value.webhookEnabled, value.webhookUrl), feishuEnabled: enabled(value.feishuEnabled, value.feishuWebhookUrl),
    telegramEnabled: enabled(value.telegramEnabled, Boolean(text(value.telegramBotToken) && text(value.telegramChatId))),
    wecomEnabled: enabled(value.wecomEnabled, value.wecomWebhookUrl),
    ...optionalText(value, 'webhookUrl'), ...optionalText(value, 'feishuWebhookUrl'), ...optionalText(value, 'telegramBotToken'),
    ...optionalText(value, 'telegramChatId'), ...optionalText(value, 'wecomWebhookUrl') };
}
function validateNotificationConfiguration(value: NotificationPolicyConfiguration, policyEnabled: boolean) {
  if (value.advanceDays < 0 || value.advanceDays > 365) throw new ServiceError(400,'提前提醒天数必须在 0 到 365 之间');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.triggerTime)) throw new ServiceError(400,'触发时间格式无效');
  try { new Intl.DateTimeFormat('en-US',{timeZone:value.timeZone}).format(); } catch { throw new ServiceError(400,'通知时区无效'); }
  const valid = (value.webhookEnabled&&value.webhookUrl)||(value.feishuEnabled&&value.feishuWebhookUrl)||(value.wecomEnabled&&value.wecomWebhookUrl)||(value.telegramEnabled&&value.telegramBotToken&&value.telegramChatId);
  if (policyEnabled && !valid) throw new ServiceError(400,'启用通知策略前，至少启用并完整配置一个通知渠道');
}
function optionalText(value:Record<string,unknown>,key:keyof NotificationPolicyConfiguration){const item=text(value[key]);return item?{[key]:item}:{};}
function integer(value:unknown,fallback:number){const n=Number(value);return Number.isInteger(n)?n:fallback;}
function time(value:unknown){const item=text(value);return item&&/^([01]\d|2[0-3]):[0-5]\d$/.test(item)?item:'09:00';}
function text(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined;}
function enabled(value:unknown,legacyValue:unknown){return typeof value==='boolean'?value:Boolean(legacyValue);}
function iso(value:unknown){return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function workspaceRisks(row:any,next?:string){const risks:string[]=[];if(row.status!=='active')risks.push('Workspace 非活动');if(row.normalized_plan==='unknown')risks.push('套餐未知');if(next&&new Date(next).getTime()<Date.now())risks.push('订阅已过期');else if(next&&new Date(next).getTime()<Date.now()+7*86400_000)risks.push('七天内续费');if(row.normalized_plan==='business'&&Number(row.fixed_occupied)>2)risks.push('固定席位超出双席位容量');return risks;}
function riskLevel(risks:string[]):WorkspaceOperationalOverviewView['riskLevel']{return risks.some(item=>item.includes('过期')||item.includes('超出'))?'critical':risks.length?'warning':'normal';}
function riskRank(level:string){return level==='critical'?0:level==='warning'?1:level==='normal'?2:3;}
function compareWorkspaceRisk(a:WorkspaceOperationalOverviewView,b:WorkspaceOperationalOverviewView){return riskRank(a.riskLevel)-riskRank(b.riskLevel)||(a.nextRenewalAt??'9999').localeCompare(b.nextRenewalAt??'9999');}
function dateKey(value:unknown){return value instanceof Date?value.toISOString().slice(0,10):typeof value==='string'?value.slice(0,10):'9999';}
function seatView(workspace:any,source:SeatOperationalOverviewView['source'],id:string,seatType:unknown,status:string,extra:any):SeatOperationalOverviewView{const expiresOn=extra.expiresOn?dateKey(extra.expiresOn):undefined;const risks:string[]=[];if(source==='fixed_vacancy')risks.push('固定 ChatGPT 空位');if(expiresOn&&expiresOn<new Date().toISOString().slice(0,10))risks.push('客户席位已到期');return{id,workspaceId:workspace.id,...(workspace.name?{workspaceName:workspace.name}:{}),workspaceExternalId:workspace.external_id,source,...extra,...(expiresOn?{expiresOn}:{}),seatType:seatType==='usage_based'?'usage_based':'default',status,riskLevel:risks.some(item=>item.includes('到期'))?'critical':risks.length?'warning':'normal',risks};}
async function latestWorkspaceBilling(db:Kysely<Database>){const rows=await db.selectFrom('billing_snapshots').select(['workspace_id','payload']).where('workspace_id','is not',null).distinctOn('workspace_id').orderBy('workspace_id').orderBy('observed_at','desc').execute();const result=new Map<string,{expectedAmount?:string;expectedCurrency?:string}>();for(const row of rows){if(!row.workspace_id)continue;const upcoming=record(row.payload.upcomingInvoice??row.payload.upcoming_invoice);const invoice=record(upcoming?.upcoming_invoice)??upcoming;const amount=invoice?.amount_due??invoice?.amount_remaining;const currency=text(invoice?.currency);result.set(row.workspace_id,{...(amount!==undefined?{expectedAmount:String(amount)}:{}),...(currency?{expectedCurrency:currency}: {})});}return result;}
function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
