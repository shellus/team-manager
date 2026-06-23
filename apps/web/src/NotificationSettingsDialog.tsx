import { useEffect, useState, type ReactNode } from 'react';
import type { NotificationSettings } from '@team-manager/shared';
import { Alert, Divider, Form, Input, InputNumber, Modal, Space, Switch, Typography } from 'antd';
import { apiClient } from './api.js';

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
  const [form] = Form.useForm<NotificationSettings>();
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
        if (cancelled) return;
        setSettings(data);
        form.setFieldsValue(data);
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
  }, [form, open]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const values = await form.validateFields();
      setSettings(
        await apiClient.updateNotificationSettings({
          ...settings,
          ...values,
          channels: {
            webhook: { ...settings.channels.webhook, ...values.channels.webhook },
            feishu: { ...settings.channels.feishu, ...values.channels.feishu },
            telegram: { ...settings.channels.telegram, ...values.channels.telegram },
            wecom: { ...settings.channels.wecom, ...values.channels.wecom }
          }
        })
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="通知设置"
      okText="保存设置"
      cancelText="取消"
      width={760}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => void save()}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        配置全局到期提醒时间和通知渠道。
      </Typography.Paragraph>
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Form<NotificationSettings>
        form={form}
        layout="vertical"
        initialValues={emptySettings}
        disabled={loading || saving}
      >
        <div className="form-grid two">
          <Form.Item
            name="advanceReminderDays"
            label="提前提醒天数"
            rules={[{ required: true, message: '请输入提前提醒天数' }]}
          >
            <InputNumber min={0} max={365} precision={0} />
          </Form.Item>
          <Form.Item
            name="triggerTime"
            label="触发时间"
            rules={[{ required: true, message: '请选择触发时间' }]}
          >
            <Input type="time" />
          </Form.Item>
        </div>

        <Divider orientation="left">通知渠道</Divider>

        <Space direction="vertical" size={16} className="panel-stack">
          <ChannelBlock
            title="通用 Webhook"
            description="发送 JSON payload 到指定 URL"
            enabledName={['channels', 'webhook', 'enabled']}
          >
            <Form.Item name={['channels', 'webhook', 'url']} label="Webhook URL">
              <Input placeholder="Webhook URL" />
            </Form.Item>
          </ChannelBlock>

          <ChannelBlock
            title="飞书机器人"
            description="使用自定义机器人 webhook"
            enabledName={['channels', 'feishu', 'enabled']}
          >
            <Form.Item name={['channels', 'feishu', 'webhookUrl']} label="飞书 webhook URL">
              <Input placeholder="飞书 webhook URL" />
            </Form.Item>
          </ChannelBlock>

          <ChannelBlock
            title="Telegram"
            description="使用 bot token 和 chat id 发送消息"
            enabledName={['channels', 'telegram', 'enabled']}
          >
            <div className="form-grid two">
              <Form.Item name={['channels', 'telegram', 'botToken']} label="Bot token">
                <Input.Password placeholder="Bot token" />
              </Form.Item>
              <Form.Item name={['channels', 'telegram', 'chatId']} label="Chat ID">
                <Input placeholder="Chat ID" />
              </Form.Item>
            </div>
          </ChannelBlock>

          <ChannelBlock
            title="企业微信机器人"
            description="使用群机器人 webhook"
            enabledName={['channels', 'wecom', 'enabled']}
          >
            <Form.Item name={['channels', 'wecom', 'webhookUrl']} label="企业微信 webhook URL">
              <Input placeholder="企业微信 webhook URL" />
            </Form.Item>
          </ChannelBlock>
        </Space>
      </Form>
    </Modal>
  );
}

function ChannelBlock({
  title,
  description,
  enabledName,
  children
}: {
  title: string;
  description: string;
  enabledName: Array<string>;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
        {children}
      </div>
      <Form.Item name={enabledName} valuePropName="checked" noStyle>
        <Switch checkedChildren="开启" unCheckedChildren="关闭" />
      </Form.Item>
    </div>
  );
}
