import { useEffect, useState } from 'react';
import type { AccountView, SeatType } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { EditOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, Select, Space, Switch, Typography } from 'antd';
import { apiClient } from '../../api.js';
import { formatRelativeTime } from '../../components/format.js';
import { SeatTag } from '../../components/StatusTag.js';
import { limitTypeLabel, planLabel, roleLabel, SEAT_LABEL } from '../../labels.js';

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
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    form.setFieldsValue({ teamName: account.workspaceName ?? '' });
  }, [account.workspaceName, form]);

  const run = async (key: string, fn: () => Promise<AccountView>) => {
    setBusy(key);
    setError('');
    try {
      onAccountChanged(await fn());
    } catch (runError) {
      setError((runError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const saveTeamName = (values: TeamNameValues) => {
    const name = values.teamName.trim();
    if (!name) return;
    void run('team-name', () => apiClient.renameTeam(account.id, name));
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
              loading={busy === 'refresh'}
              onClick={() => void run('refresh', () => apiClient.refreshSettings(account.id))}
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
          <Descriptions.Item label="限额类型">{limitTypeLabel(account.limitType)}</Descriptions.Item>
          <Descriptions.Item label="下次续费">{account.nextRenewalOn || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="workspace">{account.workspaceName || account.accountId}</Descriptions.Item>
          <Descriptions.Item label="套餐">{planLabel(account.planType)}</Descriptions.Item>
          <Descriptions.Item label="角色">{roleLabel(account.role)}</Descriptions.Item>
          <Descriptions.Item label="ChatGPT 席位">
            {(account.membersCache?.filter((member) => member.seat === 'default').length ?? '暂无')}{' '}
            / {MAX_CHATGPT_SEATS}
          </Descriptions.Item>
          <Descriptions.Item label="默认席位">
            <SeatTag seat={account.defaultSeat} />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Team 名称">
        <Form<TeamNameValues> form={form} layout="inline" onFinish={saveTeamName} className="inline-form">
          <Form.Item name="teamName" rules={[{ required: true, message: '请输入 Team 名称' }]} className="wide-form-item">
            <Input placeholder="新的 Team 名称" />
          </Form.Item>
          <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={busy === 'team-name'}>
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
              loading={busy === 'default-seat'}
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
              disabled={account.workspaceReferralsEnabledVisible === false}
              checkedChildren="允许"
              unCheckedChildren="关闭"
              loading={busy === 'workspace-referrals'}
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
              loading={busy === 'personal-access-token'}
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
              loading={busy === 'codex-device-code-auth'}
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
              loading={busy === 'codex-remote-control'}
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
