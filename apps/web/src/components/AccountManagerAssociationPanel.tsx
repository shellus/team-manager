import type { ParentAccountManagerStatus } from '@team-manager/shared';
import { Descriptions, Empty, Space, Tag, Typography } from 'antd';
import { WorkspaceOpeningStatusTags } from './WorkspaceOpeningStatusTags.js';

export function AccountManagerAssociationPanel({
  recordLabel,
  managedAccountEmail,
  status,
  loading = false
}: {
  recordLabel: '母号' | '子号';
  managedAccountEmail?: string;
  status?: ParentAccountManagerStatus | null;
  loading?: boolean;
}) {
  if (!managedAccountEmail) {
    return <Empty description={`该${recordLabel}独立录入，未关联 GPT Account Manager`} />;
  }

  return (
    <Space direction="vertical" size={12} className="panel-stack account-manager-association-panel">
      <Typography.Title level={5}>GPT Account Manager 关联</Typography.Title>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="关联状态">
          <Tag color="blue">GAM</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="账号引用">
          <Typography.Text code copyable>{managedAccountEmail}</Typography.Text>
        </Descriptions.Item>
        {status && (
          <Descriptions.Item label="服务状态">
            <AccountManagerServiceState status={status} loading={loading} />
          </Descriptions.Item>
        )}
        {status?.managed && (
          <Descriptions.Item label="开通状态">
            <Space size={6} wrap>
              <WorkspaceOpeningStatusTags
                hasCodexSpace={status.hasCodexSpace}
                hasTeamSubscription={status.hasTeamSubscription}
              />
            </Space>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="数据边界">
          Team Manager 仅保存业务所需的 Web Session；注册密码与 CloakBrowser Profile 由 GPT Account Manager 管理。
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

function AccountManagerServiceState({
  status,
  loading
}: {
  status: ParentAccountManagerStatus;
  loading: boolean;
}) {
  if (loading) return <Tag color="processing">正在读取</Tag>;
  if (status.configured === false) return <Tag>未配置</Tag>;
  if (status.reachable === false) return <Tag color="error">服务不可用</Tag>;
  if (status.managed === false) return <Tag color="warning">账号引用未受管</Tag>;
  return <Tag color="success">可用</Tag>;
}
