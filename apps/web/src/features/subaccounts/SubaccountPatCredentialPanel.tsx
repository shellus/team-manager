import { useMemo } from 'react';
import type {
  AccountSummaryView,
  CodexQuotaSnapshot,
  SubaccountCodexCredentialView,
  SubaccountTeamLink,
  SubaccountView
} from '@team-manager/shared';
import { Button, Card, Descriptions, Progress, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { actionKey, isActionBusy, type ActionBusyState } from '../../components/actionBusy.js';
import { formatDateTime } from '../../components/format.js';
import { SeatTag, TeamLinkStatusTag } from '../../components/StatusTag.js';

interface PatTeamRow {
  key: string;
  workspaceId: string;
  teamTitle: string;
  link?: SubaccountTeamLink;
  credential?: SubaccountCodexCredentialView;
}

function accountDisplayName(account: AccountSummaryView | undefined, fallback: string): string {
  return account?.remark || account?.workspaceName || account?.email || fallback;
}

function quotaLabel(credential?: SubaccountCodexCredentialView): string {
  if (!credential?.lastQuota) return '未查询额度';
  if (credential.lastQuota.status !== 'success') {
    return credential.lastQuota.status === 'error' ? '额度查询失败' : '暂无额度';
  }
  const primary = credential.lastQuota.windows[0];
  return primary?.usedPercent === null || primary?.usedPercent === undefined
    ? '额度可用'
    : `已使用 ${primary.usedPercent}%`;
}

export function SubaccountPatCredentialPanel({
  subaccount,
  accounts,
  busyState,
  quota,
  onCreate,
  onRefreshQuota,
  onExport,
  onOpenDelete
}: {
  subaccount: SubaccountView;
  accounts: AccountSummaryView[];
  busyState: ActionBusyState;
  quota: CodexQuotaSnapshot | null;
  onCreate: (workspaceId: string) => void;
  onRefreshQuota: (workspaceId: string) => void;
  onExport: (workspaceId: string) => void;
  onOpenDelete: (workspaceId: string) => void;
}) {
  const accountByInternalId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const accountByWorkspaceId = useMemo(() => new Map(accounts.map((account) => [account.accountId, account])), [accounts]);
  const credentialByWorkspaceId = useMemo(
    () => new Map(subaccount.codexCredentials.map((credential) => [credential.accountId, credential])),
    [subaccount.codexCredentials]
  );
  const rows = useMemo<PatTeamRow[]>(() => {
    const linkedRows = subaccount.teamLinks.map((link) => {
      const account = accountByInternalId.get(link.accountId);
      const workspaceId = link.workspaceId || account?.accountId || '';
      return {
        key: `link-${link.accountId}`,
        workspaceId,
        teamTitle: accountDisplayName(account, link.workspaceName || workspaceId || link.accountId),
        link,
        credential: workspaceId ? credentialByWorkspaceId.get(workspaceId) : undefined
      };
    });
    const linkedWorkspaceIds = new Set(linkedRows.map((row) => row.workspaceId).filter(Boolean));
    const credentialRows = subaccount.codexCredentials
      .filter((credential) => !linkedWorkspaceIds.has(credential.accountId))
      .map((credential) => ({
        key: `credential-${credential.accountId}`,
        workspaceId: credential.accountId,
        teamTitle: accountDisplayName(accountByWorkspaceId.get(credential.accountId), credential.accountId),
        credential
      }));
    return [...linkedRows, ...credentialRows];
  }, [accountByInternalId, accountByWorkspaceId, credentialByWorkspaceId, subaccount.codexCredentials, subaccount.teamLinks]);

  const columns: ColumnsType<PatTeamRow> = [
    {
      title: 'Team workspace',
      dataIndex: 'teamTitle',
      render: (_, row) => (
        <div className="table-main-cell">
          <Typography.Text strong>{row.teamTitle}</Typography.Text>
          <Typography.Text type="secondary">{row.workspaceId || '缺少 workspace id'}</Typography.Text>
        </div>
      )
    },
    {
      title: '关系',
      key: 'link',
      width: 160,
      render: (_, row) => row.link ? (
        <Space direction="vertical" size={4}>
          <SeatTag seat={row.link.seat} />
          <TeamLinkStatusTag status={row.link.status} />
        </Space>
      ) : '仅有 PAT'
    },
    {
      title: 'PAT 凭证',
      key: 'credential',
      width: 240,
      render: (_, row) => row.credential ? (
        <div className="table-main-cell">
          <Typography.Text strong>{row.credential.fileName}</Typography.Text>
          <Typography.Text type="secondary">
            {row.credential.groupName || '默认号池'} · {quotaLabel(row.credential)}
          </Typography.Text>
        </div>
      ) : '尚未创建'
    },
    {
      title: '操作',
      key: 'actions',
      width: 390,
      render: (_, row) => (
        <Space wrap>
          <Button
            type="primary"
            disabled={!row.workspaceId || !subaccount.hasWebSession}
            loading={isActionBusy(busyState, actionKey('pat-create', row.workspaceId))}
            onClick={() => onCreate(row.workspaceId)}
          >
            {row.credential ? '重新创建 PAT' : '创建 PAT'}
          </Button>
          <Button
            disabled={!row.credential}
            loading={isActionBusy(busyState, actionKey('quota-refresh', row.workspaceId))}
            onClick={() => onRefreshQuota(row.workspaceId)}
          >
            刷新额度
          </Button>
          <Button
            disabled={!row.credential}
            loading={isActionBusy(busyState, actionKey('pat-export', row.workspaceId))}
            onClick={() => onExport(row.workspaceId)}
          >
            下载 PAT
          </Button>
          {row.credential && (
            <Button danger onClick={() => onOpenDelete(row.credential!.accountId)}>
              删除 PAT
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <Card title="PAT 凭证概览">
        <Descriptions column={{ xs: 1, md: 3 }} bordered size="small">
          <Descriptions.Item label="Web Session">{subaccount.hasWebSession ? '已录入' : '未录入'}</Descriptions.Item>
          <Descriptions.Item label="PAT 凭证">{subaccount.codexCredentials.length} 份</Descriptions.Item>
          <Descriptions.Item label="最近更新">{formatDateTime(subaccount.updatedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Table<PatTeamRow>
        rowKey="key"
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '先同步 Team 关联，再为目标 workspace 创建 PAT' }}
      />
      {quota && (
        <Card title="本次额度刷新结果">
          <Space direction="vertical" size={12} className="panel-stack">
            {quota.windows.length === 0 ? (
              <Typography.Text type="secondary">未返回额度窗口</Typography.Text>
            ) : quota.windows.map((window) => (
              <div key={window.id}>
                <Space className="quota-window-head">
                  <Typography.Text>{window.label}</Typography.Text>
                  <Typography.Text type="secondary">{window.resetAt ? `重置 ${formatDateTime(window.resetAt)}` : ''}</Typography.Text>
                </Space>
                <Progress percent={window.usedPercent ?? 0} status={quota.status === 'error' ? 'exception' : 'normal'} />
              </div>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
