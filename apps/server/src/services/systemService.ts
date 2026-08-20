import { sql, type Kysely } from 'kysely';
import type { Database, SeatSlotRow } from '../database/schema.js';
import { TeamOrderRepository } from '../repositories/teamOrderRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { hasOutstandingInvoice } from '../repositories/billingRepository.js';
import { ServiceError } from '../serviceError.js';
import type {
  NotificationPolicyConfiguration,
  NotificationPolicyView,
  OperationalAccountReferenceView,
  OperationalRiskLevel,
  RenewalOperationalOverviewView,
  RenewalOperationalStatus,
  SeatOperationalOverviewView
} from '@team-manager/shared';

const SUPPORTED_NOTIFICATION_POLICY_KINDS = ['seat_expiration', 'workspace_renewal'] as const;

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

  saveTeamOrderConfiguration(input: { workspaceId?: string; promoCode?: string; country?: string; currency?: string; seatQuantity?: number }) {
    validateOptionalSeatQuantity(input.seatQuantity);
    return this.#orders.saveConfiguration(input.workspaceId ?? null, input);
  }

  async saveMaintenance(input: { workspaceId: string; executorAccountId: string; enabled: boolean; promoCode?: string; country?: string; currency?: string; seatQuantity?: number }) {
    validateOptionalSeatQuantity(input.seatQuantity);
    await this.#workspaces.requireManageableBy(input.workspaceId, input.executorAccountId);
    await this.#orders.saveMaintenance({
      workspaceId: input.workspaceId,
      executorAccountId: input.executorAccountId,
      enabled: input.enabled,
      overrides: input
    });
  }

  async notificationPolicies(): Promise<NotificationPolicyView[]> {
    const rows = await this.db.selectFrom('notification_policies').selectAll()
      .where('kind', 'in', [...SUPPORTED_NOTIFICATION_POLICY_KINDS]).orderBy('kind').execute();
    return rows.map((row) => ({ id: row.id, kind: row.kind, enabled: row.enabled,
      configuration: notificationConfiguration(row.configuration), updatedAt: iso(row.updated_at) }));
  }

  async saveNotificationPolicy(kind: string, input: { enabled?: boolean; configuration?: Record<string, unknown> }) {
    const normalized = kind.trim();
    if (!SUPPORTED_NOTIFICATION_POLICY_KINDS.includes(normalized as typeof SUPPORTED_NOTIFICATION_POLICY_KINDS[number])) throw new ServiceError(400, '不支持的通知策略类型');
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

  async overviewRenewals(): Promise<RenewalOperationalOverviewView[]> {
    const [workspaces, workspaceSubscriptions, managers, billing] = await Promise.all([
      this.db.selectFrom('workspaces as w').selectAll('w').select([
        sql<number>`(
          select count(*)::int from (
            select member.id from workspace_memberships member
            where member.workspace_id = w.id and member.status = 'active' and member.seat_type = 'default'
            union all
            select invitation.id from workspace_invitations invitation
            where invitation.workspace_id = w.id and invitation.status = 'pending' and invitation.seat_type = 'default'
          ) fixed_seats
        )`.as('fixed_occupied')
      ]).execute(),
      this.db.selectFrom('workspace_subscription_snapshots').selectAll()
        .distinctOn('workspace_id').orderBy('workspace_id').orderBy('observed_at', 'desc').orderBy('created_at', 'desc').execute(),
      manageableAccounts(this.db),
      latestWorkspaceBilling(this.db)
    ]);
    const workspaceSubscription = new Map(workspaceSubscriptions.map((row) => [row.workspace_id, row]));
    const result: RenewalOperationalOverviewView[] = [];
    for (const row of workspaces) {
      const subscription = workspaceSubscription.get(row.id);
      const workspaceBilling = billing.get(row.id);
      const plan = resolveWorkspacePlan(row.normalized_plan, subscription?.normalized_plan, workspaceBilling?.normalizedPlan);
      if (plan !== 'business') continue;
      const renewalAt = row.next_renewal_at ? iso(row.next_renewal_at) : subscription?.ends_at ? iso(subscription.ends_at) : undefined;
      const managingAccounts = managers.get(row.id) ?? [];
      const primaryManager = managingAccounts[0];
      if (!primaryManager || primaryManager.isBanned) continue;
      const fixedSeatCapacity = subscription?.fixed_seat_capacity ?? undefined;
      const fixedSeatOccupied = Number(row.fixed_occupied);
      const riskInput = { renewalAt, willRenew: subscription?.will_renew, workspaceStatus: row.status,
        fixedSeatCapacity, fixedSeatOccupied, paymentDue: workspaceBilling?.paymentDue };
      const risks = renewalRisks(riskInput);
      result.push({
        id: `workspace:${row.id}`, subject: 'workspace', workspaceId: row.id, workspaceExternalId: row.external_id,
        ...(row.name ? { workspaceName: row.name } : {}), status: subscription?.status ?? row.status, plan,
        ...(renewalAt ? { renewalAt } : {}), ...(subscription?.will_renew === null || subscription?.will_renew === undefined ? {} : { willRenew: subscription.will_renew }),
        ...(workspaceBilling?.defaultPaymentCardLast4 ? { defaultPaymentCardLast4: workspaceBilling.defaultPaymentCardLast4 } : {}),
        ...billingAmounts(workspaceBilling),
        fixedSeatOccupied,
        ...(fixedSeatCapacity === undefined ? {} : { fixedSeatCapacity, fixedSeatAvailable: Math.max(fixedSeatCapacity - fixedSeatOccupied, 0) }),
        ...(subscription?.subscription_seats_in_use === null || subscription?.subscription_seats_in_use === undefined
          ? {} : { subscriptionSeatsInUse: subscription.subscription_seats_in_use }),
        ...(workspaceBilling?.billedSeatQuantity === undefined ? {} : { billedSeatQuantity: workspaceBilling.billedSeatQuantity }),
        managingAccounts, operationalStatus: renewalOperationalStatus(riskInput), riskLevel: operationalRiskLevel(risks), risks
      });
    }
    return result.sort((left, right) => compareOptionalDate(left.renewalAt, right.renewalAt) || left.id.localeCompare(right.id));
  }

  async overviewSeats(): Promise<SeatOperationalOverviewView[]> {
    const [workspaces, memberships, invitations, slots, managers, subscriptions, billing] = await Promise.all([
      this.db.selectFrom('workspaces').select(['id', 'external_id', 'name', 'status', 'normalized_plan']).execute(),
      this.db.selectFrom('workspace_memberships as wm').leftJoin('accounts as a', 'a.id', 'wm.account_id')
        .select([
          'wm.id', 'wm.workspace_id', 'wm.remote_user_id', 'wm.email', 'wm.normalized_role', 'wm.seat_type',
          sql<string | null>`coalesce(wm.email, a.email)`.as('resolved_email')
        ]).where('wm.status', '=', 'active').where('wm.seat_type', '=', 'default').execute(),
      this.db.selectFrom('workspace_invitations').select([
        'id', 'workspace_id', 'email', 'normalized_role', 'seat_type'
      ]).where('status', '=', 'pending').where('seat_type', '=', 'default').execute(),
      this.db.selectFrom('seat_slots').selectAll().where('status', '!=', 'disabled').where('seat_type', '=', 'default').execute(),
      manageableAccounts(this.db),
      this.db.selectFrom('workspace_subscription_snapshots').selectAll()
        .distinctOn('workspace_id').orderBy('workspace_id').orderBy('observed_at', 'desc').orderBy('created_at', 'desc').execute(),
      latestWorkspaceBilling(this.db)
    ]);
    const membershipsByWorkspace = groupBy(memberships, (row) => row.workspace_id);
    const invitationsByWorkspace = groupBy(invitations, (row) => row.workspace_id);
    const slotsByWorkspace = groupBy(slots, (row) => row.workspace_id);
    const subscriptionByWorkspace = new Map(subscriptions.map((row) => [row.workspace_id, row]));
    const result: SeatOperationalOverviewView[] = [];
    for (const workspace of workspaces) {
      const subscription = subscriptionByWorkspace.get(workspace.id);
      const billingPlan = billing.get(workspace.id)?.normalizedPlan;
      if (!isFixedSeatOverviewWorkspace(workspace.normalized_plan, subscription?.normalized_plan, billingPlan)) continue;
      const managingAccounts = managers.get(workspace.id) ?? [];
      const remainingSlots = new Map((slotsByWorkspace.get(workspace.id) ?? []).map((slot) => [slot.id, slot]));
      const takeSlot = (email?: string | null, remoteUserId?: string | null) => {
        const normalizedEmail = normalizeOverviewEmail(email);
        const match = [...remainingSlots.values()].find((slot) =>
          Boolean(remoteUserId && slot.remote_user_id === remoteUserId)
          || Boolean(normalizedEmail && slot.normalized_current_email === normalizedEmail));
        if (match) remainingSlots.delete(match.id);
        return match;
      };
      const workspaceMemberships = membershipsByWorkspace.get(workspace.id) ?? [];
      const workspaceInvitations = invitationsByWorkspace.get(workspace.id) ?? [];
      for (const membership of workspaceMemberships) {
        const slot = takeSlot(membership.resolved_email, membership.remote_user_id);
        result.push(seatOverviewItem({
          id: `member:${membership.id}`, subject: 'member', workspace, managingAccounts,
          email: membership.resolved_email, role: membership.normalized_role,
          seatType: membership.seat_type, status: 'member', slot
        }));
      }
      for (const invitation of workspaceInvitations) {
        const slot = takeSlot(invitation.email);
        result.push(seatOverviewItem({
          id: `invitation:${invitation.id}`, subject: 'invitation', workspace, managingAccounts,
          email: invitation.email, role: invitation.normalized_role,
          seatType: invitation.seat_type, status: 'invited', slot
        }));
      }
      const fixedOccupied = workspaceMemberships.length + workspaceInvitations.length;
      const fixedSeatCapacity = subscription?.fixed_seat_capacity ?? undefined;
      const fixedAvailable = workspace.status === 'active' && fixedSeatCapacity !== undefined
        ? Math.max(fixedSeatCapacity - fixedOccupied, 0) : 0;
      for (let index = 0; index < fixedAvailable; index += 1) {
        const slot = [...remainingSlots.values()].find((row) => row.seat_type === 'default' && row.status === 'empty');
        if (slot) remainingSlots.delete(slot.id);
        result.push(seatOverviewItem({
          id: `vacancy:${workspace.id}:${index + 1}`, subject: 'vacancy', workspace, managingAccounts,
          seatType: 'default', status: 'empty', slot
        }));
      }
      for (const slot of remainingSlots.values()) {
        result.push(seatOverviewItem({
          id: `customer:${slot.id}`, subject: 'customer', workspace, managingAccounts,
          email: slot.current_email, seatType: slot.seat_type, status: slot.status, slot
        }));
      }
    }
    return result.sort((left, right) => compareOptionalDate(left.expiresOn, right.expiresOn)
      || seatSubjectOrder(left.subject) - seatSubjectOrder(right.subject) || left.id.localeCompare(right.id));
  }
}

type SeatOverviewWorkspace = { id: string; external_id: string; name: string | null; status: string };
type SeatOverviewSlot = SeatSlotRow;

function seatOverviewItem(input: {
  id: string;
  subject: SeatOperationalOverviewView['subject'];
  workspace: SeatOverviewWorkspace;
  managingAccounts: OperationalAccountReferenceView[];
  email?: string | null;
  role?: string | null;
  seatType?: string | null;
  status: string;
  slot?: SeatOverviewSlot;
}): SeatOperationalOverviewView {
  const expiresOn = input.slot?.expires_on ? dateKey(input.slot.expires_on) : undefined;
  const tracksCustomerExpiry = Boolean(input.slot) && input.subject !== 'vacancy';
  const risks = seatRisks(expiresOn, input.workspace.status, input.managingAccounts.length === 0, new Date(), tracksCustomerExpiry);
  return {
    id: input.id, subject: input.subject, workspaceId: input.workspace.id, workspaceExternalId: input.workspace.external_id,
    ...(input.workspace.name ? { workspaceName: input.workspace.name } : {}), ...(input.email ? { email: input.email } : {}),
    seatType: input.seatType === 'usage_based' ? 'usage_based' : 'default', status: input.status,
    ...(normalizeOverviewRole(input.role) ? { role: normalizeOverviewRole(input.role) } : {}),
    ...(input.slot ? { seatSlotId: input.slot.id } : {}), hasCustomerProfile: Boolean(input.slot),
    ...(input.slot?.contact ? { contact: input.slot.contact } : {}), ...(input.slot?.remark ? { remark: input.slot.remark } : {}),
    ...(expiresOn ? { expiresOn } : {}), ...(input.slot?.price ? { price: input.slot.price } : {}),
    managingAccounts: input.managingAccounts, riskLevel: operationalRiskLevel(risks), risks
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function normalizeOverviewEmail(value?: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeOverviewRole(value?: string | null): SeatOperationalOverviewView['role'] | undefined {
  return ['owner', 'admin', 'member', 'analytics_viewer'].includes(value ?? '')
    ? value as SeatOperationalOverviewView['role']
    : value ? 'unknown' : undefined;
}

function seatSubjectOrder(value: SeatOperationalOverviewView['subject']): number {
  return { member: 0, invitation: 1, vacancy: 2, customer: 3 }[value];
}

function isFixedSeatOverviewWorkspace(workspacePlan?: string | null, subscriptionPlan?: string | null, billingPlan?: string): boolean {
  if (workspacePlan === 'business_usage_based') return false;
  if (workspacePlan !== 'business' && subscriptionPlan === 'business_usage_based') return false;
  return resolveWorkspacePlan(workspacePlan ?? undefined, subscriptionPlan ?? undefined, billingPlan) === 'business';
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
function dateKey(value:unknown){return value instanceof Date?value.toISOString().slice(0,10):typeof value==='string'?value.slice(0,10):'9999';}
function compareOptionalDate(left?:string,right?:string){if(!left||!right)return left?-1:right?1:0;return left.localeCompare(right);}
function resolveWorkspacePlan(...plans:Array<string|undefined>){if(plans.includes('business'))return'business';if(plans.includes('business_usage_based'))return'business_usage_based';return'unknown';}
function normalizedLimitType(value:string):'unknown'|'weekly'|'monthly'{return value==='weekly'||value==='monthly'?value:'unknown';}
export function renewalRisks(input:{renewalAt?:string;willRenew?:boolean|null;accountIsBanned?:boolean;workspaceStatus?:string;lacksManager?:boolean;fixedSeatCapacity?:number;fixedSeatOccupied?:number;paymentDue?:boolean},now=new Date()){const risks:string[]=[];const current=now.getTime();if(input.paymentDue)risks.push('当期账单待支付');if(!input.renewalAt)risks.push('续费时间未知');else{const at=new Date(input.renewalAt).getTime();if(at<current)risks.push(input.willRenew===false?'订阅已到期':'续费时间已过');else if(at<=current+3*86400_000)risks.push('三天内到期');}if(input.accountIsBanned)risks.push('账号已封号');if(input.workspaceStatus&&input.workspaceStatus!=='active')risks.push('Workspace 非活动');if(input.lacksManager)risks.push('缺少可管理账号');if(input.fixedSeatCapacity!==undefined&&input.fixedSeatOccupied!==undefined&&input.fixedSeatOccupied>input.fixedSeatCapacity)risks.push('固定席位超出容量');return risks;}
export function renewalOperationalStatus(input:{renewalAt?:string;willRenew?:boolean|null;workspaceStatus?:string;fixedSeatCapacity?:number;fixedSeatOccupied?:number;paymentDue?:boolean},now=new Date()):RenewalOperationalStatus{const current=now.getTime();if(input.paymentDue)return'payment_due';if(input.renewalAt&&new Date(input.renewalAt).getTime()<current)return'expired';if(input.fixedSeatCapacity!==undefined&&input.fixedSeatOccupied!==undefined&&input.fixedSeatOccupied>input.fixedSeatCapacity)return'seat_over_capacity';if(input.workspaceStatus&&input.workspaceStatus!=='active')return'inactive';if(input.renewalAt&&new Date(input.renewalAt).getTime()<=current+3*86400_000)return'expiring_soon';if(!input.renewalAt)return'renewal_unknown';return'normal';}
export function seatRisks(expiresOn:string|undefined,workspaceStatus:string,lacksManager:boolean,now=new Date(),trackCustomerExpiry=true){const risks:string[]=[];const today=now.toISOString().slice(0,10);const soon=new Date(now.getTime()+3*86400_000).toISOString().slice(0,10);if(trackCustomerExpiry){if(!expiresOn)risks.push('未设置到期日');else if(expiresOn<today)risks.push('客户席位已到期');else if(expiresOn<=soon)risks.push('三天内到期');}if(workspaceStatus!=='active')risks.push('Workspace 非活动');if(lacksManager)risks.push('缺少可管理账号');return risks;}
function operationalRiskLevel(risks:string[]):OperationalRiskLevel{if(risks.some(item=>item.includes('已到期')||item.includes('已过')||item.includes('超出')||item.includes('缺少可管理')))return'critical';if(risks.length===0)return'normal';if(risks.every(item=>item.includes('未知')||item.includes('未设置')))return'unknown';return'warning';}
async function manageableAccounts(db:Kysely<Database>):Promise<Map<string,OperationalAccountReferenceView[]>>{const rows=await db.selectFrom('workspace_memberships as wm').innerJoin('accounts as a','a.id','wm.account_id').innerJoin('account_operational_profiles as op','op.account_id','a.id').select(['wm.workspace_id','wm.normalized_role','a.id','a.email','a.remark','a.is_banned','op.limit_type']).where('wm.status','=','active').where('wm.normalized_role','in',['owner','admin']).execute();const result=new Map<string,OperationalAccountReferenceView[]>();for(const row of rows){const list=result.get(row.workspace_id)??[];list.push({id:row.id,email:row.email,...(row.remark?{remark:row.remark}:{}),role:row.normalized_role as 'owner'|'admin',isBanned:row.is_banned,limitType:normalizedLimitType(row.limit_type)});result.set(row.workspace_id,list);}for(const list of result.values())list.sort((left,right)=>(left.role==='owner'?0:1)-(right.role==='owner'?0:1)||left.email.localeCompare(right.email));return result;}
type BillingSummary={expectedAmount?:string;expectedCurrency?:string;normalizedPlan?:string;defaultPaymentCardLast4?:string;billedSeatQuantity?:number;paymentDue:boolean};
function billingAmounts(summary?:BillingSummary){return summary?{...(summary.expectedAmount?{expectedAmount:summary.expectedAmount}:{}),...(summary.expectedCurrency?{expectedCurrency:summary.expectedCurrency}:{})}:{};}
async function latestWorkspaceBilling(db:Kysely<Database>){const [rows,defaultCards]=await Promise.all([db.selectFrom('billing_snapshots').select(['workspace_id','normalized_workspace_plan','payload']).where('workspace_id','is not',null).distinctOn('workspace_id').orderBy('workspace_id').orderBy('observed_at','desc').orderBy('created_at','desc').execute(),db.selectFrom('payment_method_summaries').select(['workspace_id','last4']).where('workspace_id','is not',null).where('is_default','=',true).distinctOn('workspace_id').orderBy('workspace_id').orderBy('observed_at','desc').orderBy('created_at','desc').execute()]);const cardByWorkspace=new Map(defaultCards.flatMap(row=>row.workspace_id&&row.last4?[[row.workspace_id,row.last4] as const]:[]));const result=new Map<string,BillingSummary>();for(const row of rows)if(row.workspace_id)result.set(row.workspace_id,{...billingSummary(row.payload,row.normalized_workspace_plan),...(cardByWorkspace.get(row.workspace_id)?{defaultPaymentCardLast4:cardByWorkspace.get(row.workspace_id)}:{})});return result;}
function billingSummary(payload:Record<string,unknown>,normalizedPlan?:string|null):BillingSummary{const upcoming=record(payload.upcomingInvoice??payload.upcoming_invoice);const invoice=record(upcoming?.upcoming_invoice)??upcoming;const amount=invoice?.amount_due??invoice?.amount_remaining;const currency=text(invoice?.currency);const billedSeatQuantity=invoiceSeatQuantity(invoice);return{...(amount!==undefined?{expectedAmount:String(amount)}:{}),...(currency?{expectedCurrency:currency}: {}),...(normalizedPlan?{normalizedPlan}:{}),...(billedSeatQuantity===undefined?{}:{billedSeatQuantity}),paymentDue:hasOutstandingInvoice(payload)};}
function invoiceSeatQuantity(invoice:Record<string,unknown>|undefined):number|undefined{const lines=record(invoice?.lines);const items=Array.isArray(lines?.data)?lines.data.map(record).filter(Boolean) as Record<string,unknown>[]:[];const recurring=items.find(item=>item.type==='subscription'||record(item.price)?.recurring!==undefined)??items[0];const quantity=Number(recurring?.quantity);return Number.isSafeInteger(quantity)&&quantity>0?quantity:undefined;}
function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function validateOptionalSeatQuantity(value:unknown):void{if(value!==undefined&&(!Number.isSafeInteger(value)||Number(value)<=0))throw new ServiceError(400,'订单席位数必须是正整数');}
