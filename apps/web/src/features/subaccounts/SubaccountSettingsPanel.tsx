import { useEffect, useState } from 'react';
import type { SubaccountView, WebSessionCheckStatus } from '@team-manager/shared';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, Avatar, Button, Card, Collapse, Descriptions, Form, Input, Space, Switch, Tag, Typography } from 'antd';
import { apiClient } from '../../api.js';
import { formatRelativeTime } from '../../components/format.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { cleanSubaccountError, subaccountErrorSummary } from './errorHandling.js';

interface ProfileValues {
  username: string;
  displayName: string;
}

function CheckStatusTag({ status }: { status?: WebSessionCheckStatus }) {
  if (status === 'valid') return <Tag color="success">有效</Tag>;
  if (status === 'invalid') return <Tag color="error">无效</Tag>;
  return <Tag>未验证</Tag>;
}

function cacheLabel(cachedAt?: number): string {
  return cachedAt ? `同步于 ${formatRelativeTime(cachedAt)}` : '尚未同步';
}

export function SubaccountSettingsPanel({
  subaccount,
  onSubaccountChanged
}: {
  subaccount: SubaccountView;
  onSubaccountChanged: (subaccount: SubaccountView) => void;
}) {
  const [form] = Form.useForm<ProfileValues>();
  const [error, setError] = useState('');
  const actionBusy = useActionBusy();

  useEffect(() => {
    form.setFieldsValue({
      username: subaccount.remoteUsername ?? '',
      displayName: subaccount.remoteDisplayName ?? ''
    });
  }, [form, subaccount.remoteDisplayName, subaccount.remoteUsername]);

  const run = async (key: string, fn: () => Promise<SubaccountView>) => {
    setError('');
    try {
      await actionBusy.run(key, async () => onSubaccountChanged(await fn()));
    } catch (runError) {
      setError((runError as Error).message);
    }
  };

  const saveProfile = (values: ProfileValues) => {
    void run('subaccount-profile-save', () =>
      apiClient.updateSubaccountPersonalProfile(subaccount.id, {
        username: values.username.trim(),
        displayName: values.displayName.trim()
      })
    );
  };

  const credits = subaccount.rateLimitResetCredits;

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {error && <Alert type="error" showIcon message={error} />}
      {subaccount.lastError && (
        <Alert
          type="warning"
          showIcon
          message={subaccount.status === 'error' ? '账号操作失败' : '最近一次同步存在失败步骤'}
          description={
            <Space direction="vertical" size={4} className="panel-stack">
              <Typography.Text>{subaccountErrorSummary(subaccount.lastError)}</Typography.Text>
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'sync-error',
                    label: '查看完整错误与调用信息',
                    children: (
                      <Typography.Text className="preserve-lines">
                        {cleanSubaccountError(subaccount.lastError)}
                      </Typography.Text>
                    )
                  }
                ]}
              />
            </Space>
          }
        />
      )}

      <Card title="个人资料">
        <div className="personal-profile-summary">
          <Avatar size={56} src={subaccount.remotePictureUrl}>
            {(subaccount.remoteDisplayName || subaccount.email).slice(0, 1).toUpperCase()}
          </Avatar>
          <Descriptions column={{ xs: 1, md: 2 }} bordered size="small" className="personal-profile-descriptions">
            <Descriptions.Item label="邮箱">{subaccount.email}</Descriptions.Item>
            <Descriptions.Item label="显示名">{subaccount.remoteDisplayName || '尚未同步'}</Descriptions.Item>
            <Descriptions.Item label="用户名">{subaccount.remoteUsername || '尚未设置'}</Descriptions.Item>
            <Descriptions.Item label="user id">
              {subaccount.chatgptUserId ? <Typography.Text copyable>{subaccount.chatgptUserId}</Typography.Text> : '尚未同步'}
            </Descriptions.Item>
            <Descriptions.Item label="account.id">
              {subaccount.chatgptAccountId ? <Typography.Text copyable>{subaccount.chatgptAccountId}</Typography.Text> : '暂无'}
            </Descriptions.Item>
            <Descriptions.Item label="资料同步">{formatRelativeTime(subaccount.personalProfileCachedAt)}</Descriptions.Item>
          </Descriptions>
        </div>

        <Form<ProfileValues>
          form={form}
          layout="vertical"
          className="personal-profile-form"
          disabled={actionBusy.isBusy('subaccount-profile-save')}
          onFinish={saveProfile}
        >
          <div className="personal-profile-fields">
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input autoComplete="off" placeholder="username" />
            </Form.Item>
            <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]}>
              <Input autoComplete="off" placeholder="显示名" />
            </Form.Item>
          </div>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            htmlType="submit"
            loading={actionBusy.isBusy('subaccount-profile-save')}
            disabled={!subaccount.hasWebSession}
          >
            保存个人资料
          </Button>
        </Form>
      </Card>

      <Card title="常用设置">
        <Space direction="vertical" size={0} className="panel-stack">
          <SettingSwitch
            title="营销通知推送"
            description="ChatGPT 产品和功能更新的 Push 通知"
            value={subaccount.marketingPushEnabled}
            cachedAt={subaccount.marketingNotificationsCachedAt}
            busy={actionBusy.isBusy('marketing-push')}
            disabled={!subaccount.hasWebSession}
            onChange={(checked) =>
              void run('marketing-push', () =>
                apiClient.setSubaccountMarketingNotifications(subaccount.id, { marketingPushEnabled: checked })
              )
            }
          />
          <SettingSwitch
            title="营销通知邮件"
            description="ChatGPT 产品和功能更新的 Email 通知"
            value={subaccount.marketingEmailEnabled}
            cachedAt={subaccount.marketingNotificationsCachedAt}
            busy={actionBusy.isBusy('marketing-email')}
            disabled={!subaccount.hasWebSession}
            onChange={(checked) =>
              void run('marketing-email', () =>
                apiClient.setSubaccountMarketingNotifications(subaccount.id, { marketingEmailEnabled: checked })
              )
            }
          />
          <SettingSwitch
            title="记忆"
            description="允许 ChatGPT 根据对话、文件和已连接应用个性化回答"
            value={subaccount.memoryEnabled}
            cachedAt={subaccount.memoryCachedAt}
            busy={actionBusy.isBusy('memory')}
            disabled={!subaccount.hasWebSession}
            onChange={(checked) =>
              void run('memory', () => apiClient.setSubaccountMemoryEnabled(subaccount.id, checked))
            }
          />
        </Space>
      </Card>

      <Card title="用量限制">
        <Descriptions column={{ xs: 1, md: 3 }} bordered size="small">
          <Descriptions.Item label="当前可用">{credits?.availableCount ?? '尚未同步'}</Descriptions.Item>
          <Descriptions.Item label="累计获得">{credits?.totalEarnedCount ?? '尚未同步'}</Descriptions.Item>
          <Descriptions.Item label="同步时间">{formatRelativeTime(credits?.cachedAt)}</Descriptions.Item>
        </Descriptions>
        {credits && (
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'credits',
                label: `Credits 明细 (${credits.credits.length})`,
                children: (
                  <Typography.Text code className="preserve-lines">
                    {JSON.stringify(credits.credits, null, 2)}
                  </Typography.Text>
                )
              }
            ]}
          />
        )}
      </Card>

      <Card title="登录态">
        <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label="Session Cookie">
            <Space size={6} wrap>
              <CheckStatusTag status={subaccount.sessionTokenStatus} />
              <Typography.Text type="secondary">{formatRelativeTime(subaccount.sessionTokenCheckedAt)}</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Web Access Token">
            <Space size={6} wrap>
              <CheckStatusTag status={subaccount.webAccessTokenStatus} />
              <Typography.Text type="secondary">/backend-api/me · {formatRelativeTime(subaccount.webAccessTokenCheckedAt)}</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="完整同步">{formatRelativeTime(subaccount.lastRefreshAt)}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

function SettingSwitch({
  title,
  description,
  value,
  cachedAt,
  busy,
  disabled,
  onChange
}: {
  title: string;
  description: string;
  value?: boolean;
  cachedAt?: number;
  busy: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <Space size={8} wrap>
          <Typography.Text strong>{title}</Typography.Text>
          {value === undefined && <Tag>未知</Tag>}
        </Space>
        <Typography.Paragraph type="secondary">{description}，{cacheLabel(cachedAt)}</Typography.Paragraph>
      </div>
      <Switch
        checked={value === true}
        checkedChildren="开启"
        unCheckedChildren="关闭"
        loading={busy}
        disabled={disabled || busy}
        onChange={onChange}
      />
    </div>
  );
}
