import { useMemo, useState } from 'react';
import type { AccountSummaryView, SeatType, SubaccountTeamLink, SubaccountView } from '@team-manager/shared';
import { LinkOutlined, LogoutOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { actionKey } from '../../components/actionBusy.js';
import { apiClient } from '../../api.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { SeatTag, TeamLinkStatusTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { visibleTeamLinks } from './subaccountTeamLinks.js';

function accountDisplayName(account: AccountSummaryView | undefined, fallback: string): string {
  if (!account) return fallback;
  return account.remark || account.workspaceName || account.email;
}

function teamLinkDisplayName(link: SubaccountTeamLink, account: AccountSummaryView | undefined): string {
  return accountDisplayName(account, link.workspaceName || link.workspaceId || link.accountId);
}

function teamLinkWorkspaceId(link: SubaccountTeamLink, account: AccountSummaryView | undefined): string {
  return link.workspaceId || account?.accountId || link.accountId;
}

export function SubaccountTeamLinks({
  subaccount,
  accounts,
  onSubaccountChanged,
  onOpenInvite
}: {
  subaccount: SubaccountView;
  accounts: AccountSummaryView[];
  onSubaccountChanged: (subaccount: SubaccountView) => void;
  onOpenInvite: () => void;
}) {
  const actionBusy = useActionBusy();
  const [error, setError] = useState('');
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const teamLinks = useMemo(
    () => visibleTeamLinks(subaccount.teamLinks).sort((a, b) => teamLinkDisplayName(a, accountById.get(a.accountId)).localeCompare(teamLinkDisplayName(b, accountById.get(b.accountId)))),
    [accountById, subaccount.teamLinks]
  );
  const syncedAt = teamLinks.reduce<number | undefined>((latest, link) => (latest ? Math.max(latest, link.updatedAt) : link.updatedAt), undefined);

  const syncTeamLinks = async () => {
    setError('');
    try {
      await actionBusy.run('team-link-sync', async () => {
        onSubaccountChanged(await apiClient.syncSubaccountTeamLinks(subaccount.id));
      });
    } catch (syncError) {
      setError((syncError as Error).message);
    }
  };

  const leaveTeam = async (workspaceId: string) => {
    if (!workspaceId) return;
    setError('');
    try {
      await actionBusy.run(actionKey('team-link-leave', workspaceId), async () => {
        onSubaccountChanged(await apiClient.leaveSubaccountTeam(subaccount.id, workspaceId));
      });
    } catch (leaveError) {
      setError((leaveError as Error).message);
    }
  };

  const columns: ColumnsType<SubaccountTeamLink> = [
    {
      title: 'Team',
      dataIndex: 'accountId',
      render: (_, link) => {
        const account = accountById.get(link.accountId);
        return (
          <div className="table-main-cell">
            <Typography.Text strong>{teamLinkDisplayName(link, account)}</Typography.Text>
            <Typography.Text type="secondary">{teamLinkWorkspaceId(link, account)}</Typography.Text>
          </div>
        );
      }
    },
    {
      title: '席位',
      dataIndex: 'seat',
      width: 140,
      render: (seat: SeatType) => <SeatTag seat={seat} />
    },
    {
      title: '关系',
      dataIndex: 'status',
      width: 130,
      render: (status) => <TeamLinkStatusTag status={status} />
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: (value) => formatDateTime(value)
    },
    {
      title: '操作',
      width: 130,
      render: (_, link) => {
        const account = accountById.get(link.accountId);
        const workspaceId = teamLinkWorkspaceId(link, account);
        return (
          <Button
            size="small"
            danger
            icon={<LogoutOutlined />}
            disabled={!workspaceId || link.status === 'removed'}
            loading={actionBusy.isBusy(actionKey('team-link-leave', workspaceId))}
            onClick={() => void leaveTeam(workspaceId)}
          >
            退出 Team
          </Button>
        );
      }
    }
  ];

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">上次同步 {formatRelativeTime(syncedAt)}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} loading={actionBusy.isBusy('team-link-sync')} onClick={() => void syncTeamLinks()}>
            刷新关联
          </Button>
          <Tooltip title={subaccount.isBanned ? '封号子号不能邀请加入 Team' : undefined}>
            <span>
              <Button type="primary" icon={<LinkOutlined />} disabled={subaccount.isBanned} onClick={onOpenInvite}>
                邀请加入 Team
              </Button>
            </span>
          </Tooltip>
        </Space>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Table<SubaccountTeamLink>
        rowKey={(link) => teamLinkWorkspaceId(link, accountById.get(link.accountId))}
        columns={columns}
        dataSource={teamLinks}
        pagination={false}
        locale={{ emptyText: '暂无 Team 关联记录' }}
      />
    </Space>
  );
}
