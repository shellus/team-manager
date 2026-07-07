import { useMemo } from 'react';
import type {
  AccountView,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  SubaccountCodexCredentialView,
  SubaccountTeamLink,
  SubaccountView
} from '@team-manager/shared';
import { actionKey, isActionBusy, type ActionBusyState } from '../../components/actionBusy.js';
import { Button, Card, Descriptions, Progress, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatDateTime } from '../../components/format.js';
import { SeatTag, TeamLinkStatusTag } from '../../components/StatusTag.js';

interface CredentialTeamRow {
  key: string;
  workspaceId: string;
  teamTitle: string;
  planType?: string;
  link?: SubaccountTeamLink;
  credential?: SubaccountCodexCredentialView;
  account?: AccountView;
}

function accountDisplayName(account: AccountView | undefined, fallback: string): string {
  if (!account) return fallback;
  return account.remark || account.workspaceName || account.email;
}

function teamLinkWorkspaceId(link: SubaccountTeamLink, account: AccountView | undefined): string {
  return link.workspaceId || account?.accountId || '';
}

function teamLinkDisplayName(link: SubaccountTeamLink, account: AccountView | undefined): string {
  return accountDisplayName(account, link.workspaceName || link.workspaceId || link.accountId);
}

function quotaLabel(credential?: SubaccountCodexCredentialView): string {
  if (!credential?.lastQuota) return '暂无额度';
  if (credential.lastQuota.status !== 'success') return credential.lastQuota.status === 'error' ? '查询异常' : '暂无额度';
  const primary = credential.lastQuota.windows[0];
  return primary?.usedPercent === null || primary?.usedPercent === undefined ? '额度可用' : `${primary.usedPercent}%`;
}

export function SubaccountCredentialPanel({
  subaccount,
  accounts,
  runtimeStatus,
  busyState,
  quota,
  onStartAuth,
  onAutoAuth,
  onCreatePersonalAccessToken,
  onRefreshQuota,
  onCopyCredentialAccessToken,
  onExportCredential,
  onOpenDeleteCredential
}: {
  subaccount: SubaccountView;
  accounts: AccountView[];
  runtimeStatus: CodexAuthRuntimeStatus | null;
  busyState: ActionBusyState;
  quota: CodexQuotaSnapshot | null;
  onStartAuth: (workspaceId: string, teamTitle: string) => void;
  onAutoAuth: (workspaceId: string) => void;
  onCreatePersonalAccessToken: (workspaceId: string) => void;
  onRefreshQuota: (workspaceId: string) => void;
  onCopyCredentialAccessToken: (workspaceId: string) => void;
  onExportCredential: (workspaceId: string) => void;
  onOpenDeleteCredential: (workspaceId: string) => void;
}) {
  const accountByInternalId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const accountByWorkspaceId = useMemo(() => new Map(accounts.map((account) => [account.accountId, account])), [accounts]);
  const credentialByWorkspaceId = useMemo(
    () => new Map(subaccount.codexCredentials.map((credential) => [credential.accountId, credential])),
    [subaccount.codexCredentials]
  );
  const rows = useMemo<CredentialTeamRow[]>(() => {
    const linkedRows = subaccount.teamLinks.map((link) => {
      const account = accountByInternalId.get(link.accountId);
      const workspaceId = teamLinkWorkspaceId(link, account);
      return {
        key: `link-${link.accountId}`,
        workspaceId,
        teamTitle: teamLinkDisplayName(link, account),
        planType: link.planType,
        link,
        account,
        credential: workspaceId ? credentialByWorkspaceId.get(workspaceId) : undefined
      };
    });
    const linkedWorkspaceIds = new Set(linkedRows.map((row) => row.workspaceId).filter(Boolean));
    const credentialRows = subaccount.codexCredentials
      .filter((credential) => !linkedWorkspaceIds.has(credential.accountId))
      .map((credential) => {
        const account = accountByWorkspaceId.get(credential.accountId);
        return {
          key: `credential-${credential.accountId}`,
          workspaceId: credential.accountId,
          teamTitle: accountDisplayName(account, credential.accountId),
          planType: credential.planType,
          account,
          credential
        };
      });
    return [...linkedRows, ...credentialRows];
  }, [accountByInternalId, accountByWorkspaceId, credentialByWorkspaceId, subaccount.codexCredentials, subaccount.teamLinks]);

  const columns: ColumnsType<CredentialTeamRow> = [
    {
      title: 'Team workspace',
      dataIndex: 'teamTitle',
      render: (_, row) => (
        <div className="table-main-cell">
          <Typography.Text strong>{row.teamTitle}</Typography.Text>
          <Typography.Text type="secondary">{row.workspaceId || row.link?.accountId || '缺少 workspace id'}</Typography.Text>
        </div>
      )
    },
    {
      title: '关系',
      key: 'link',
      width: 160,
      render: (_, row) =>
        row.link ? (
          <Space direction="vertical" size={4}>
            <SeatTag seat={row.link.seat} />
            <TeamLinkStatusTag status={row.link.status} />
          </Space>
        ) : (
          '仅有凭证'
        )
    },
    {
      title: '凭证',
      key: 'credential',
      width: 220,
      render: (_, row) =>
        row.credential ? (
          <div className="table-main-cell">
            <Typography.Text strong>{row.credential.fileName}</Typography.Text>
            <Typography.Text type="secondary">
              {row.credential.groupName || '默认号池'} · {quotaLabel(row.credential)}
            </Typography.Text>
          </div>
        ) : (
          '未生成凭证'
        )
    },
    {
      title: '操作',
      key: 'actions',
      width: 520,
      render: (_, row) => (
        <Space wrap>
          <Button
            type="primary"
            disabled={!row.workspaceId || !subaccount.hasWebSession}
            loading={isActionBusy(busyState, actionKey('codex-pat', row.workspaceId))}
            onClick={() => onCreatePersonalAccessToken(row.workspaceId)}
          >
            {row.planType === 'k12' ? '创建 K12 凭证' : '创建令牌'}
          </Button>
          <Button
            disabled={!row.workspaceId || row.planType === 'k12' || runtimeStatus?.codexAutoAuth === false}
            loading={isActionBusy(busyState, actionKey('codex-auto', row.workspaceId))}
            onClick={() => onAutoAuth(row.workspaceId)}
          >
            自动授权
          </Button>
          <Button
            disabled={!row.workspaceId || row.planType === 'k12'}
            loading={isActionBusy(busyState, actionKey('codex-start', row.workspaceId))}
            onClick={() => onStartAuth(row.workspaceId, row.teamTitle)}
          >
            登录 URL
          </Button>
          <Button
            disabled={!row.credential}
            loading={isActionBusy(busyState, actionKey('quota-refresh', row.workspaceId))}
            onClick={() => onRefreshQuota(row.workspaceId)}
          >
            刷新额度
          </Button>
          <Button
            disabled={!row.workspaceId || !row.credential}
            loading={isActionBusy(busyState, actionKey('credential-copy-ak', row.workspaceId))}
            onClick={() => onCopyCredentialAccessToken(row.workspaceId)}
          >
            复制 AK
          </Button>
          <Button
            disabled={!row.workspaceId || !row.credential}
            loading={isActionBusy(busyState, actionKey('credential-export', row.workspaceId))}
            onClick={() => onExportCredential(row.workspaceId)}
          >
            凭证 JSON
          </Button>
          {row.credential && (
            <Button danger onClick={() => onOpenDeleteCredential(row.credential!.accountId)}>
              删除凭证
            </Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <Card title="凭证概览">
        <Descriptions column={{ xs: 1, md: 3 }} bordered size="small">
          <Descriptions.Item label="Web Session">{subaccount.hasWebSession ? '已录入' : '未录入'}</Descriptions.Item>
          <Descriptions.Item label="Codex 凭证">{subaccount.codexCredentials.length} 份</Descriptions.Item>
          <Descriptions.Item label="最近更新">{formatDateTime(subaccount.updatedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Table<CredentialTeamRow>
        rowKey="key"
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '先同步 Team 关联，再按 workspace 生成 Codex 凭证' }}
      />
      {quota && (
        <Card title="本次额度刷新结果">
          <Space direction="vertical" size={12} className="panel-stack">
            {quota.windows.length === 0 && <Typography.Text>{quota.error ?? '暂无额度窗口'}</Typography.Text>}
            {quota.windows.map((window) => (
              <div className="quota-row" key={window.id}>
                <div>
                  <Typography.Text strong>{window.label}</Typography.Text>
                  <Typography.Text type="secondary">重置 {window.resetAt ? formatDateTime(window.resetAt) : '暂无'}</Typography.Text>
                </div>
                <Progress percent={window.usedPercent ?? 0} status={quota.status === 'success' ? 'active' : 'exception'} />
              </div>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
