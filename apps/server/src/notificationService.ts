import type { Account, AccountSeatSlot, NotificationSettings } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { AppSettingsStore } from './appSettingsStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ExpirationReminderItemBase {
  accountId: string;
  workspaceName: string;
  remark?: string;
  expiresOn: string;
  daysUntilExpiry: number;
}

export interface TeamRenewalReminderItem extends ExpirationReminderItemBase {
  type: 'team_renewal';
  ownerEmail: string;
}

export interface SeatExpirationReminderItem extends ExpirationReminderItemBase {
  type: 'seat_expiration';
  email: string;
  expireRemove: boolean;
  status: 'invited' | 'member' | 'tracked';
}

export type ExpirationReminderItem = TeamRenewalReminderItem | SeatExpirationReminderItem;

export interface NotificationRunResult {
  itemCount: number;
  sentChannels: string[];
  errors: string[];
}

type Fetcher = typeof fetch;

export function collectExpirationReminderItems(
  accounts: Account[],
  settings: Pick<NotificationSettings, 'advanceReminderDays'>,
  now = new Date()
): ExpirationReminderItem[] {
  const today = localDateOnlyTime(now);
  const items: ExpirationReminderItem[] = [];

  for (const account of accounts) {
    const renewal = accountDateTime(account.nextRenewalOn);
    if (renewal !== undefined) {
      const daysUntilExpiry = Math.floor((renewal - today) / DAY_MS);
      if (daysUntilExpiry >= 0 && daysUntilExpiry <= settings.advanceReminderDays) {
        items.push({
          type: 'team_renewal',
          accountId: account.id,
          workspaceName: account.workspaceName ?? account.accountId,
          ownerEmail: account.email,
          ...(account.remark ? { remark: account.remark } : {}),
          expiresOn: account.nextRenewalOn!,
          daysUntilExpiry
        });
      }
    }

    const seatSlots = account.seatSlots ?? [];
    for (const slot of seatSlots) {
      if (!slot.expireReminder) continue;
      const expiry = slotDateTime(slot);
      if (expiry === undefined) continue;
      const daysUntilExpiry = Math.floor((expiry - today) / DAY_MS);
      if (daysUntilExpiry < 0 || daysUntilExpiry > settings.advanceReminderDays) continue;

      items.push({
        type: 'seat_expiration',
        accountId: account.id,
        workspaceName: account.workspaceName ?? account.accountId,
        email: slot.email ?? '未绑定邮箱',
        ...(slot.remark ? { remark: slot.remark } : {}),
        expiresOn: slot.expiresOn,
        daysUntilExpiry,
        expireRemove: slot.expireRemove,
        status: slot.email ? relationStatus(account, slot.email) : 'tracked'
      });
    }
  }

  return items.sort(
    (a, b) => a.daysUntilExpiry - b.daysUntilExpiry || reminderSortLabel(a).localeCompare(reminderSortLabel(b))
  );
}

export function shouldRunExpirationReminder(settings: NotificationSettings, now = new Date()): boolean {
  const runDate = localDateString(now);
  if (settings.lastRunDate === runDate) return false;
  return localTimeString(now) >= settings.triggerTime;
}

export async function sendExpirationReminders(
  settings: NotificationSettings,
  items: ExpirationReminderItem[],
  fetcher: Fetcher = fetch
): Promise<NotificationRunResult> {
  const sentChannels: string[] = [];
  const errors: string[] = [];
  if (items.length === 0) return { itemCount: 0, sentChannels, errors };

  const text = formatExpirationReminderText(settings, items);
  const teamRenewalCount = items.filter((item) => item.type === 'team_renewal').length;
  const seatExpirationCount = items.length - teamRenewalCount;
  const payload = {
    type: 'expiration_reminder',
    advanceReminderDays: settings.advanceReminderDays,
    itemCount: items.length,
    teamRenewalCount,
    seatExpirationCount,
    text,
    items
  };

  await sendChannel('webhook', settings.channels.webhook.enabled && settings.channels.webhook.url, errors, async (url) => {
    await postJson(fetcher, url, payload);
    sentChannels.push('webhook');
  });
  await sendChannel('feishu', settings.channels.feishu.enabled && settings.channels.feishu.webhookUrl, errors, async (url) => {
    await postJson(fetcher, url, { msg_type: 'text', content: { text } });
    sentChannels.push('feishu');
  });
  await sendChannel('wecom', settings.channels.wecom.enabled && settings.channels.wecom.webhookUrl, errors, async (url) => {
    await postJson(fetcher, url, { msgtype: 'text', text: { content: text } });
    sentChannels.push('wecom');
  });
  if (settings.channels.telegram.enabled && settings.channels.telegram.botToken && settings.channels.telegram.chatId) {
    try {
      await postJson(fetcher, `https://api.telegram.org/bot${settings.channels.telegram.botToken}/sendMessage`, {
        chat_id: settings.channels.telegram.chatId,
        text
      });
      sentChannels.push('telegram');
    } catch (e) {
      errors.push(`telegram: ${(e as Error).message}`);
    }
  }

  return { itemCount: items.length, sentChannels, errors };
}

export function startNotificationScheduler(
  settingsStore: AppSettingsStore,
  accountStore: AccountStore,
  intervalMs = 60 * 1000
): () => void {
  const tick = async () => {
    const settings = settingsStore.getNotificationSettings();
    const now = new Date();
    if (!shouldRunExpirationReminder(settings, now)) return;

    const items = collectExpirationReminderItems(accountStore.list(), settings, now);
    const result = await sendExpirationReminders(settings, items);
    const runDate = localDateString(now);
    if (shouldMarkNotificationRun(result)) {
      await settingsStore.markNotificationRun(runDate);
    }
    if (result.errors.length > 0) {
      console.warn('[team-manager] 到期提醒发送存在失败:', result.errors.join('; '));
    }
  };

  const timer = setInterval(() => {
    tick().catch((e) => {
      console.warn('[team-manager] 到期提醒任务失败:', (e as Error).message);
    });
  }, intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}

function shouldMarkNotificationRun(result: NotificationRunResult): boolean {
  return result.itemCount === 0 || result.errors.length === 0 || result.sentChannels.length > 0;
}

function relationStatus(account: Account, email: string): SeatExpirationReminderItem['status'] {
  const target = email.toLowerCase();
  if (account.membersCache?.some((member) => member.seat === 'default' && member.email.toLowerCase() === target)) {
    return 'member';
  }
  if (account.pendingInvitesCache?.some((invite) => invite.seat === 'default' && invite.email.toLowerCase() === target)) {
    return 'invited';
  }
  return 'tracked';
}

function reminderSortLabel(item: ExpirationReminderItem): string {
  return item.type === 'team_renewal' ? item.workspaceName : item.email;
}

function slotDateTime(slot: AccountSeatSlot): number | undefined {
  return accountDateTime(slot.expiresOn);
}

function accountDateTime(dateOnly: string | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly ?? '');
  if (!match) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function localDateOnlyTime(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimeString(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function formatExpirationReminderText(
  settings: Pick<NotificationSettings, 'advanceReminderDays'>,
  items: ExpirationReminderItem[]
): string {
  const teamRenewals = items.filter((item) => item.type === 'team_renewal');
  const seatExpirations = items.filter((item) => item.type === 'seat_expiration');
  const lines = [`Team 到期提醒：未来 ${settings.advanceReminderDays} 天内共 ${items.length} 项`, ''];

  lines.push(`Team 续费（${teamRenewals.length}）`);
  if (teamRenewals.length === 0) {
    lines.push('- 无');
  } else {
    for (const item of teamRenewals) {
      lines.push(formatReminderLine(item.remark, item.ownerEmail, item.expiresOn, item.daysUntilExpiry));
    }
  }

  lines.push('', `客户席位到期（${seatExpirations.length}）`);
  if (seatExpirations.length === 0) {
    lines.push('- 无');
  } else {
    for (const item of seatExpirations) {
      lines.push(formatReminderLine(item.remark, item.email, item.expiresOn, item.daysUntilExpiry));
    }
  }
  return lines.join('\n');
}

function formatReminderLine(
  remark: string | undefined,
  email: string,
  expiresOn: string,
  daysUntilExpiry: number
): string {
  return `- 备注：${remark?.trim() || '无'}｜邮箱：${email}｜到期：${expiresOn}（剩余 ${daysUntilExpiry} 天）`;
}

async function sendChannel(
  name: string,
  url: string | false,
  errors: string[],
  send: (url: string) => Promise<void>
): Promise<void> {
  if (!url) return;
  try {
    await send(url);
  } catch (e) {
    errors.push(`${name}: ${(e as Error).message}`);
  }
}

async function postJson(fetcher: Fetcher, url: string, body: unknown): Promise<void> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
