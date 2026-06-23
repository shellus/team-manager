import { useEffect, useId, useState } from 'react';
import type { NotificationSettings } from '@team-manager/shared';
import { apiClient } from './api.js';
import { SettingSwitch } from './SettingSwitch.js';

const emptySettings: NotificationSettings = {
  advanceReminderDays: 3,
  triggerTime: '08:00',
  channels: {
    webhook: { enabled: false, url: '' },
    feishu: { enabled: false, webhookUrl: '' },
    telegram: { enabled: false, botToken: '', chatId: '' },
    wecom: { enabled: false, webhookUrl: '' }
  }
};

export function NotificationSettingsDialog({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [settings, setSettings] = useState<NotificationSettings>(emptySettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    apiClient
      .getNotificationSettings()
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, saving]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      setSettings(await apiClient.updateNotificationSettings(settings));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="modal-panel notification-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>通知设置</h2>
            <p>配置全局到期提醒时间和通知渠道。</p>
          </div>
          {loading && <span className="small-status">读取中</span>}
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="settings-dialog-body">
          <section className="settings-group">
            <div className="settings-group-head">
              <h3>提醒规则</h3>
            </div>
            <div className="setting-list">
              <div className="setting-row">
                <div className="setting-copy">
                  <strong>提前提醒天数</strong>
                  <span>到期日前多少天进入提醒窗口</span>
                </div>
                <div className="setting-control">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={settings.advanceReminderDays}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        advanceReminderDays: Number(event.target.value)
                      }))
                    }
                  />
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>触发时间</strong>
                  <span>默认每天早上 08:00 检查一次</span>
                </div>
                <div className="setting-control">
                  <input
                    type="time"
                    value={settings.triggerTime}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        triggerTime: event.target.value
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <div className="settings-group-head">
              <h3>通知渠道</h3>
            </div>
            <div className="setting-list">
              <div className="setting-row">
                <div className="setting-copy">
                  <strong>通用 Webhook</strong>
                  <span>发送 JSON payload 到指定 URL</span>
                </div>
                <div className="channel-control">
                  <SettingSwitch
                    label="启用通用 Webhook"
                    checked={settings.channels.webhook.enabled}
                    offLabel="关闭"
                    onChange={(enabled) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          webhook: { ...current.channels.webhook, enabled }
                        }
                      }))
                    }
                    onLabel="开启"
                  />
                  <input
                    value={settings.channels.webhook.url}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          webhook: { ...current.channels.webhook, url: event.target.value }
                        }
                      }))
                    }
                    placeholder="Webhook URL"
                  />
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>飞书机器人</strong>
                  <span>使用自定义机器人 webhook</span>
                </div>
                <div className="channel-control">
                  <SettingSwitch
                    label="启用飞书机器人"
                    checked={settings.channels.feishu.enabled}
                    offLabel="关闭"
                    onChange={(enabled) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          feishu: { ...current.channels.feishu, enabled }
                        }
                      }))
                    }
                    onLabel="开启"
                  />
                  <input
                    value={settings.channels.feishu.webhookUrl}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          feishu: { ...current.channels.feishu, webhookUrl: event.target.value }
                        }
                      }))
                    }
                    placeholder="飞书 webhook URL"
                  />
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>Telegram</strong>
                  <span>使用 bot token 和 chat id 发送消息</span>
                </div>
                <div className="channel-control channel-control-pair">
                  <SettingSwitch
                    label="启用 Telegram"
                    checked={settings.channels.telegram.enabled}
                    offLabel="关闭"
                    onChange={(enabled) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          telegram: { ...current.channels.telegram, enabled }
                        }
                      }))
                    }
                    onLabel="开启"
                  />
                  <input
                    value={settings.channels.telegram.botToken}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          telegram: { ...current.channels.telegram, botToken: event.target.value }
                        }
                      }))
                    }
                    placeholder="Bot token"
                  />
                  <input
                    value={settings.channels.telegram.chatId}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          telegram: { ...current.channels.telegram, chatId: event.target.value }
                        }
                      }))
                    }
                    placeholder="Chat ID"
                  />
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <strong>企业微信机器人</strong>
                  <span>使用群机器人 webhook</span>
                </div>
                <div className="channel-control">
                  <SettingSwitch
                    label="启用企业微信机器人"
                    checked={settings.channels.wecom.enabled}
                    offLabel="关闭"
                    onChange={(enabled) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          wecom: { ...current.channels.wecom, enabled }
                        }
                      }))
                    }
                    onLabel="开启"
                  />
                  <input
                    value={settings.channels.wecom.webhookUrl}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        channels: {
                          ...current.channels,
                          wecom: { ...current.channels.wecom, webhookUrl: event.target.value }
                        }
                      }))
                    }
                    placeholder="企业微信 webhook URL"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className="primary" onClick={save} disabled={saving || loading}>
            {saving ? '保存中' : '保存设置'}
          </button>
        </div>
      </section>
    </div>
  );
}
