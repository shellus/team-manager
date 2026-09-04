export const MAX_NOTIFICATION_TEXT_BYTES = 1800;
const MAX_DETAIL_ITEMS = 10;

export interface SeatExpiryNotificationItem {
  seatSlotId: string;
  email?: string;
  relationStatus?: 'unclaimed';
  expiresOn: string;
  expireRemove: boolean;
  workspaceId: string;
  workspaceName?: string;
  workspaceExternalId?: string;
}

export interface WorkspaceRenewalNotificationItem {
  workspaceId: string;
  externalId: string;
  name?: string;
  plan?: string;
  nextRenewalAt: string;
}

export interface NotificationMessageContext {
  observedAt: string;
  timeZone: string;
  windowStart?: string;
  windowEnd?: string;
  managementUrl?: string;
}

export interface NotificationMessage {
  summaryText: string;
  text: string;
}

export function seatExpiryMessage(
  items: SeatExpiryNotificationItem[],
  context: NotificationMessageContext,
  previousItems?: SeatExpiryNotificationItem[]
): NotificationMessage {
  const sorted = [...items].sort((left, right) => left.expiresOn.localeCompare(right.expiresOn)
    || workspaceLabel(left).localeCompare(workspaceLabel(right)) || seatLabel(left).localeCompare(seatLabel(right)));
  const lines = [
    `客户席位到期提醒｜${items.length} 项`,
    `统计时间：${formatInstant(context.observedAt, context.timeZone)}（${context.timeZone}）`,
    ...(context.windowStart && context.windowEnd ? [`提醒范围：${context.windowStart} 至 ${context.windowEnd}`] : []),
    `到期后处理：自动移除 ${items.filter((item) => item.expireRemove).length} 项，不自动移除 ${items.filter((item) => !item.expireRemove).length} 项`
  ];
  const change = expiryChange(items, previousItems);
  if (change) lines.push(`较上次：新增 ${change.added} 项，移出提醒范围 ${change.removed} 项`);

  let currentDate = '';
  for (const item of sorted.slice(0, MAX_DETAIL_ITEMS)) {
    const date = item.expiresOn.slice(0, 10);
    if (date !== currentDate) {
      currentDate = date;
      lines.push('', `${date}（${remainingDays(date, context.observedAt, context.timeZone)}）`);
    }
    lines.push(`• ${workspaceLabel(item)}｜${seatLabel(item)}｜${item.expireRemove ? '到期后自动移除' : '到期后不自动移除'}`);
  }
  appendRemainder(lines, items.length);
  return { summaryText: lines[0], text: fitMessage(lines, context.managementUrl) };
}

export function workspaceRenewalMessage(
  items: WorkspaceRenewalNotificationItem[],
  context: NotificationMessageContext
): NotificationMessage {
  const sorted = [...items].sort((left, right) => left.nextRenewalAt.localeCompare(right.nextRenewalAt)
    || renewalWorkspaceLabel(left).localeCompare(renewalWorkspaceLabel(right)));
  const lines = [
    `Team Workspace 续费提醒｜${items.length} 项`,
    `统计时间：${formatInstant(context.observedAt, context.timeZone)}（${context.timeZone}）`,
    ...(context.windowStart && context.windowEnd ? [`提醒范围：${context.windowStart} 至 ${context.windowEnd}`] : [])
  ];
  let currentDate = '';
  for (const item of sorted.slice(0, MAX_DETAIL_ITEMS)) {
    const localDate = dateInTimeZone(item.nextRenewalAt, context.timeZone);
    if (localDate !== currentDate) {
      currentDate = localDate;
      lines.push('', `${localDate}（${remainingDays(localDate, context.observedAt, context.timeZone)}）`);
    }
    lines.push(`• ${renewalWorkspaceLabel(item)}｜${item.plan || '计划未知'}｜${formatInstant(item.nextRenewalAt, context.timeZone)}`);
  }
  appendRemainder(lines, items.length);
  return { summaryText: lines[0], text: fitMessage(lines, context.managementUrl) };
}

export function seatRemovalFailureMessage(
  item: Partial<SeatExpiryNotificationItem> & { attemptCount?: number; maxAttempts?: number; error?: string },
  context: NotificationMessageContext
): NotificationMessage {
  const summaryText = '客户席位自动移除失败｜需要人工处理';
  const lines = [
    summaryText,
    `发生时间：${formatInstant(context.observedAt, context.timeZone)}（${context.timeZone}）`,
    `Workspace：${workspaceLabel(item)}`,
    `席位：${item.email || item.seatSlotId || '未知'}`,
    ...(item.expiresOn ? [`到期日：${item.expiresOn.slice(0, 10)}（应于次日 00:00 移除）`] : []),
    ...(item.attemptCount !== undefined && item.maxAttempts !== undefined
      ? [`重试：已完成 ${item.attemptCount}/${item.maxAttempts} 次，有限重试已耗尽`] : []),
    `失败原因：${cleanReason(item.error)}`,
    '处理要求：请检查远端成员关系、执行账号权限和上游接口状态后人工处理。'
  ];
  return { summaryText, text: fitMessage(lines, context.managementUrl) };
}

export function notificationTestMessage(kind: string, context: NotificationMessageContext): NotificationMessage {
  if (kind === 'workspace_renewal') {
    const sample = workspaceRenewalMessage([{
      workspaceId: 'sample-workspace', externalId: 'ws-sample', name: '示例 Workspace', plan: 'business',
      nextRenewalAt: context.observedAt
    }], context);
    return { summaryText: `[测试] ${sample.summaryText}`, text: `[测试通知｜不会触发业务操作]\n${sample.text}` };
  }
  const sampleDate = context.windowEnd || dateInTimeZone(context.observedAt, context.timeZone);
  const sample = seatExpiryMessage([{
    seatSlotId: 'sample-seat', email: 'sample@example.com', expiresOn: sampleDate,
    expireRemove: false, workspaceId: 'sample-workspace', workspaceName: '示例 Workspace'
  }], context);
  return { summaryText: `[测试] ${sample.summaryText}`, text: `[测试通知｜不会触发业务操作]\n${sample.text}` };
}

export function notificationTextBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function expiryChange(current: SeatExpiryNotificationItem[], previous?: SeatExpiryNotificationItem[]) {
  if (!previous) return undefined;
  const currentKeys = new Set(current.map(expiryKey));
  const previousKeys = new Set(previous.map(expiryKey));
  return {
    added: [...currentKeys].filter((key) => !previousKeys.has(key)).length,
    removed: [...previousKeys].filter((key) => !currentKeys.has(key)).length
  };
}

function expiryKey(item: SeatExpiryNotificationItem) { return `${item.seatSlotId}\u0000${item.expiresOn.slice(0, 10)}`; }
function workspaceLabel(item: Partial<SeatExpiryNotificationItem>) { return item.workspaceName || item.workspaceExternalId || item.workspaceId || '未知 Workspace'; }
function seatLabel(item: Partial<SeatExpiryNotificationItem>) { return item.email || (item.relationStatus === 'unclaimed' ? '待认领席位' : item.seatSlotId) || '未知席位'; }
function renewalWorkspaceLabel(item: WorkspaceRenewalNotificationItem) { return item.name || item.externalId || item.workspaceId; }
function appendRemainder(lines: string[], count: number) { if (count > MAX_DETAIL_ITEMS) lines.push('', `另有 ${count - MAX_DETAIL_ITEMS} 项未展开，请进入管理后台查看。`); }

function fitMessage(lines: string[], managementUrl?: string): string {
  const footer = managementUrl ? `\n\n管理入口：${managementUrl}` : '';
  const body = lines.join('\n');
  if (notificationTextBytes(body + footer) <= MAX_NOTIFICATION_TEXT_BYTES) return body + footer;
  const notice = '\n…明细已截断，请进入管理后台查看。';
  const allowed = MAX_NOTIFICATION_TEXT_BYTES - notificationTextBytes(footer + notice);
  return truncateUtf8(body, allowed) + notice + footer;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = '';
  for (const character of value) {
    if (notificationTextBytes(result + character) > maxBytes) break;
    result += character;
  }
  return result.trimEnd();
}

function cleanReason(value?: string): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') || '未知错误';
  return truncateUtf8(normalized, 600);
}

function remainingDays(date: string, observedAt: string, timeZone: string): string {
  const today = dateInTimeZone(observedAt, timeZone);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  if (days > 1) return `${days} 天后到期`;
  return `已过期 ${Math.abs(days)} 天`;
}

function dateInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

function formatInstant(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')} ${part(parts, 'hour')}:${part(parts, 'minute')}`;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value || '';
}
