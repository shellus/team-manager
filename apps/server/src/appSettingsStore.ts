import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NotificationSettings } from '@team-manager/shared';

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  advanceReminderDays: 3,
  triggerTime: '08:00',
  channels: {
    webhook: { enabled: false, url: '' },
    feishu: { enabled: false, webhookUrl: '' },
    telegram: { enabled: false, botToken: '', chatId: '' },
    wecom: { enabled: false, webhookUrl: '' }
  }
};

function cloneDefaults(): NotificationSettings {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS)) as NotificationSettings;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readStringField(record: Record<string, unknown>, key: string, fallback: string): string {
  return hasOwn(record, key) ? readString(record[key]) : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readReminderDays(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(365, Math.floor(value)));
}

function readTriggerTime(value: unknown, fallback: string): string {
  const candidate = readString(value);
  if (!/^\d{2}:\d{2}$/.test(candidate)) return fallback;
  const [hour, minute] = candidate.split(':').map((part) => Number(part));
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return candidate;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeNotificationSettings(
  input: unknown,
  fallback: NotificationSettings = cloneDefaults()
): NotificationSettings {
  const raw = recordValue(input);
  const rawChannels = recordValue(raw.channels);
  const webhook = recordValue(rawChannels.webhook);
  const feishu = recordValue(rawChannels.feishu);
  const telegram = recordValue(rawChannels.telegram);
  const wecom = recordValue(rawChannels.wecom);

  return {
    advanceReminderDays: readReminderDays(raw.advanceReminderDays, fallback.advanceReminderDays),
    triggerTime: readTriggerTime(raw.triggerTime, fallback.triggerTime),
    channels: {
      webhook: {
        enabled: readBoolean(webhook.enabled, fallback.channels.webhook.enabled),
        url: readStringField(webhook, 'url', fallback.channels.webhook.url)
      },
      feishu: {
        enabled: readBoolean(feishu.enabled, fallback.channels.feishu.enabled),
        webhookUrl: readStringField(feishu, 'webhookUrl', fallback.channels.feishu.webhookUrl)
      },
      telegram: {
        enabled: readBoolean(telegram.enabled, fallback.channels.telegram.enabled),
        botToken: readStringField(telegram, 'botToken', fallback.channels.telegram.botToken),
        chatId: readStringField(telegram, 'chatId', fallback.channels.telegram.chatId)
      },
      wecom: {
        enabled: readBoolean(wecom.enabled, fallback.channels.wecom.enabled),
        webhookUrl: readStringField(wecom, 'webhookUrl', fallback.channels.wecom.webhookUrl)
      }
    },
    lastRunDate: readString(raw.lastRunDate) || fallback.lastRunDate,
    lastRunAt: typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : fallback.lastRunAt
  };
}

export class AppSettingsStore {
  private readonly file: string;
  private settings = cloneDefaults();
  private loaded = false;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, 'app-settings.json');
  }

  async init(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }
    if (existsSync(this.file)) {
      try {
        const raw = await readFile(this.file, 'utf8');
        this.settings = normalizeNotificationSettings(JSON.parse(raw));
      } catch (e) {
        throw new Error(`读取 app-settings.json 失败: ${(e as Error).message}`);
      }
    }
    this.loaded = true;
  }

  getNotificationSettings(): NotificationSettings {
    this.ensureLoaded();
    return normalizeNotificationSettings(this.settings);
  }

  async updateNotificationSettings(input: unknown): Promise<NotificationSettings> {
    this.ensureLoaded();
    this.settings = normalizeNotificationSettings(input, this.settings);
    await this.persist();
    return this.getNotificationSettings();
  }

  async markNotificationRun(date: string, ranAt = Date.now()): Promise<NotificationSettings> {
    this.ensureLoaded();
    this.settings = normalizeNotificationSettings({ ...this.settings, lastRunDate: date, lastRunAt: ranAt });
    await this.persist();
    return this.getNotificationSettings();
  }

  private ensureLoaded() {
    if (!this.loaded) throw new Error('AppSettingsStore 未 init()');
  }

  private async persist(): Promise<void> {
    await writeFile(this.file, JSON.stringify(this.settings, null, 2), 'utf8');
  }
}
