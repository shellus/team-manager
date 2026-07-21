import { useEffect, useState } from 'react';
import type { AccountView, SeatType } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { EditOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Switch, Typography } from 'antd';
import { apiClient } from '../../api.js';
import { formatRelativeTime } from '../../components/format.js';
import { DefaultSeatTag, LimitTypeTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { planLabel, roleLabel, SEAT_LABEL } from '../../labels.js';
import { parentChatGptSeatUsageCount } from './parentListItem.js';

interface TeamNameValues {
  teamName: string;
}

export function ParentSettingsPanel({
  account,
  onAccountChanged,
  onOpenLocalProfile
}: {
  account: AccountView;
  onAccountChanged: (account: AccountView) => void;
  onOpenLocalProfile: () => void;
}) {
  const [form] = Form.useForm<TeamNameValues>();
  const [error, setError] = useState('');
  const actionBusy = useActionBusy();

  useEffect(() => {
    form.setFieldsValue({ teamName: account.workspaceName ?? '' });
  }, [account.workspaceName, form]);

  const run = async (key: string, fn: () => Promise<AccountView>) => {
    setError('');
    try {
      await actionBusy.run(key, async () => {
        onAccountChanged(await fn());
      });
    } catch (runError) {
      setError((runError as Error).message);
    }
  };

  const saveTeamName = (values: TeamNameValues) => {
    const name = values.teamName.trim();
    if (!name) return;
    void run('team-name', () => apiClient.renameTeam(account.id, name));
  };

  const changeAutomaticReload = (checked: boolean) => {
    if (!checked) {
      void run('automatic-reload', () => apiClient.setAutomaticReloadEnabled(account.id, false));
      return;
    }
    Modal.confirm({
      title: '开启 Automatic reload？',
      content: 'Credits 余额低于远端阈值时会自动使用默认支付方式补款；当前余额已低于阈值时可能立即扣款。',
      okText: '开启自动补款',
      cancelText: '取消',
      onOk: () => run('automatic-reload', () => apiClient.setAutomaticReloadEnabled(account.id, true))
    });
  };

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {error && <Alert type="error" showIcon message={error} />}
      <Card
        title="Workspace"
        extra={
          <Space>
            <Button icon={<EditOutlined />} onClick={onOpenLocalProfile}>
              本地资料
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={actionBusy.isBusy('settings-refresh')}
              onClick={() => void run('settings-refresh', () => apiClient.refreshSettings(account.id))}
            >
              刷新设置
            </Button>
          </Space>
        }
      >
        <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
          <Descriptions.Item label="owner">{account.email}</Descriptions.Item>
          <Descriptions.Item label="备注">{account.remark || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="分组">{account.groupName || '默认分组'}</Descriptions.Item>
          <Descriptions.Item label="限额类型"><LimitTypeTag limitType={account.limitType} /></Descriptions.Item>
          <Descriptions.Item label="下次续费">{account.nextRenewalOn || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="workspace">{account.workspaceName || account.accountId}</Descriptions.Item>
          <Descriptions.Item label="套餐">{planLabel(account.planType)}</Descriptions.Item>
          <Descriptions.Item label="角色">{roleLabel(account.role)}</Descriptions.Item>
          <Descriptions.Item label="ChatGPT 席位">
            {(parentChatGptSeatUsageCount(account) ?? '暂无')}{' '}
            / {MAX_CHATGPT_SEATS}
          </Descriptions.Item>
          <Descriptions.Item label="默认席位">
            <DefaultSeatTag seat={account.defaultSeat} />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Credits">
        <div className="setting-row">
          <div>
            <Typography.Text strong>Automatic reload</Typography.Text>
            <Typography.Paragraph type="secondary">
              Credits 余额不足时自动使用默认支付方式补款。上次刷新{' '}
              {formatRelativeTime(account.automaticReloadCachedAt)}
            </Typography.Paragraph>
          </div>
          <Switch
            checked={Boolean(account.automaticReloadEnabled)}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            disabled={actionBusy.isBusy('automatic-reload')}
            loading={actionBusy.isBusy('automatic-reload')}
            onChange={changeAutomaticReload}
          />
        </div>
      </Card>

      <Card title="Team 名称">
        <Form<TeamNameValues>
          form={form}
          layout="inline"
          disabled={actionBusy.isBusy('team-name')}
          onFinish={saveTeamName}
          className="inline-form"
        >
          <Form.Item name="teamName" rules={[{ required: true, message: '请输入 Team 名称' }]} className="wide-form-item">
            <Input placeholder="新的 Team 名称" />
          </Form.Item>
          <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={actionBusy.isBusy('team-name')}>
            保存名称
          </Button>
        </Form>
      </Card>

      <Card title="席位与权限">
        <Space direction="vertical" size={16} className="panel-stack">
          <div className="setting-row">
            <div>
              <Typography.Text strong>新成员默认席位</Typography.Text>
              <Typography.Paragraph type="secondary">
                上次刷新 {formatRelativeTime(account.defaultSeatCachedAt)}
              </Typography.Paragraph>
            </div>
            <Select<SeatType>
              value={account.defaultSeat}
              placeholder="未设置"
              loading={actionBusy.isBusy('default-seat')}
              disabled={actionBusy.isBusy('default-seat')}
              options={[
                { value: 'usage_based', label: SEAT_LABEL.usage_based },
                { value: 'default', label: SEAT_LABEL.default }
              ]}
              onChange={(seat) => void run('default-seat', () => apiClient.setDefaultSeat(account.id, seat))}
            />
          </div>

          <div className="setting-row">
            <div>
              <Typography.Text strong>允许成员发送 Codex 邀请</Typography.Text>
              <Typography.Paragraph type="secondary">
                上次刷新 {formatRelativeTime(account.workspaceReferralsEnabledCachedAt)}
              </Typography.Paragraph>
            </div>
            <Switch
              checked={Boolean(account.workspaceReferralsEnabled)}
              disabled={account.workspaceReferralsEnabledVisible === false || actionBusy.isBusy('workspace-referrals')}
              checkedChildren="允许"
              unCheckedChildren="关闭"
              loading={actionBusy.isBusy('workspace-referrals')}
              onChange={(checked) =>
                void run('workspace-referrals', () => apiClient.setWorkspaceReferralsEnabled(account.id, checked))
              }
            />
          </div>

          <div className="setting-row">
            <div>
              <Typography.Text strong>允许用户创建个人访问令牌</Typography.Text>
              <Typography.Paragraph type="secondary">
                上次刷新 {formatRelativeTime(account.personalAccessTokensCachedAt)}
              </Typography.Paragraph>
            </div>
            <Switch
              checked={Boolean(account.personalAccessTokensEnabled)}
              checkedChildren="允许"
              unCheckedChildren="关闭"
              disabled={actionBusy.isBusy('personal-access-token')}
              loading={actionBusy.isBusy('personal-access-token')}
              onChange={(checked) =>
                void run('personal-access-token', () => apiClient.setPersonalAccessTokensEnabled(account.id, checked))
              }
            />
          </div>

          <div className="setting-row">
            <div>
              <Typography.Text strong>允许成员使用 Codex Local</Typography.Text>
              <Typography.Paragraph type="secondary">
                上次刷新 {formatRelativeTime(account.codexLocalAccessCachedAt)}
              </Typography.Paragraph>
            </div>
            <Switch
              checked={Boolean(account.codexLocalAccessEnabled)}
              checkedChildren="允许"
              unCheckedChildren="关闭"
              disabled
            />
          </div>

          <div className="setting-row">
            <div>
              <Typography.Text strong>为 Codex CLI 启用设备代码身份验证</Typography.Text>
              <Typography.Paragraph type="secondary">
                上次刷新 {formatRelativeTime(account.codexDeviceCodeAuthCachedAt)}
              </Typography.Paragraph>
            </div>
            <Switch
              checked={Boolean(account.codexDeviceCodeAuthEnabled)}
              checkedChildren="允许"
              unCheckedChildren="关闭"
              disabled={actionBusy.isBusy('codex-device-code-auth')}
              loading={actionBusy.isBusy('codex-device-code-auth')}
              onChange={(checked) =>
                void run('codex-device-code-auth', () => apiClient.setCodexDeviceCodeAuthEnabled(account.id, checked))
              }
            />
          </div>

          <div className="setting-row">
            <div>
              <Typography.Text strong>允许成员远程发现并控制设备</Typography.Text>
              <Typography.Paragraph type="secondary">
                上次刷新 {formatRelativeTime(account.codexRemoteControlCachedAt)}
              </Typography.Paragraph>
            </div>
            <Switch
              checked={Boolean(account.codexRemoteControlEnabled)}
              checkedChildren="允许"
              unCheckedChildren="关闭"
              disabled={actionBusy.isBusy('codex-remote-control')}
              loading={actionBusy.isBusy('codex-remote-control')}
              onChange={(checked) =>
                void run('codex-remote-control', () => apiClient.setCodexRemoteControlEnabled(account.id, checked))
              }
            />
          </div>
        </Space>
      </Card>
    </Space>
  );
}
