import type { Account, AccountMemberProfile, NotificationSettings } from '@team-manager/shared';
import { AccountStore } from './accountStore.js';
import { AppSettingsStore } from './appSettingsStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpirationReminderItem {
  type: 'member_expiration' | 'team_renewal';
  accountId: string;
  accountDisplayName: string;
  workspaceName: string;
  email: string;
  remark?: string;
  expiresOn: string;
  daysUntilExpiry: number;
  expireRemove: boolean;
  status: 'invited' | 'member' | 'tracked' | 'team_renewal';
}

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
          accountDisplayName: account.remark || account.email,
          workspaceName: account.workspaceName ?? account.accountId,
          email: account.email,
          ...(account.remark ? { remark: account.remark } : {}),
          expiresOn: account.nextRenewalOn!,
          daysUntilExpiry,
          expireRemove: false,
          status: 'team_renewal'
        });
      }
    }

    const profiles = account.memberProfiles ?? {};
    for (const profile of Object.values(profiles)) {
      if (!profile.expireReminder) continue;
      const expiry = profileDateTime(profile);
      if (expiry === undefined) continue;
      const daysUntilExpiry = Math.floor((expiry - today) / DAY_MS);
      if (daysUntilExpiry < 0 || daysUntilExpiry > settings.advanceReminderDays) continue;

      items.push({
        type: 'member_expiration',
        accountId: account.id,
        accountDisplayName: account.remark || account.email,
        workspaceName: account.workspaceName ?? account.accountId,
        email: profile.email,
        ...(profile.remark ? { remark: profile.remark } : {}),
        expiresOn: profile.expiresOn,
        daysUntilExpiry,
        expireRemove: profile.expireRemove,
        status: relationStatus(account, profile.email)
      });
    }
  }

  return items.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry || a.email.localeCompare(b.email));
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

  const text = formatReminderText(settings, items);
  const payload = {
    type: 'member_expiration_reminder',
    advanceReminderDays: settings.advanceReminderDays,
    itemCount: items.length,
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

function relationStatus(account: Account, email: string): ExpirationReminderItem['status'] {
  const target = email.toLowerCase();
  if (account.membersCache?.some((member) => member.email.toLowerCase() === target)) return 'member';
  if (account.pendingInvitesCache?.some((invite) => invite.email.toLowerCase() === target)) return 'invited';
  return 'tracked';
}

function profileDateTime(profile: AccountMemberProfile): number | undefined {
  return accountDateTime(profile.expiresOn);
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

function formatReminderText(settings: NotificationSettings, items: ExpirationReminderItem[]): string {
  const lines = [`Team 成员到期提醒：${items.length} 个邮箱将在 ${settings.advanceReminderDays} 天内到期`];
  for (const item of items) {
    if (item.type === 'team_renewal') {
      const remark = item.remark ? `，备注：${item.remark}` : '';
      lines.push(
        `- ${item.workspaceName}，Team 续费，${item.expiresOn} 续费，剩余 ${item.daysUntilExpiry} 天${remark}`
      );
      continue;
    }
    const statusLabel = item.status === 'member' ? '成员' : item.status === 'invited' ? '待邀请' : '仅记录';
    const removeLabel = item.expireRemove ? '到期移除' : '仅提醒';
    const remark = item.remark ? `，备注：${item.remark}` : '';
    lines.push(
      `- ${item.email}，${item.workspaceName}，${statusLabel}，${item.expiresOn} 到期，剩余 ${item.daysUntilExpiry} 天，${removeLabel}${remark}`
    );
  }
  return lines.join('\n');
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
