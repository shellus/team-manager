import { useMemo, useState } from 'react';
import type { AccountView, SeatType, SubaccountTeamLink, SubaccountView } from '@team-manager/shared';
import { LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { SeatTag, TeamLinkStatusTag } from '../../components/StatusTag.js';

function accountDisplayName(account: AccountView | undefined, fallback: string): string {
  if (!account) return fallback;
  return account.note || account.workspaceName || account.email;
}

export function SubaccountTeamLinks({
  subaccount,
  accounts,
  onSubaccountChanged,
  onOpenInvite
}: {
  subaccount: SubaccountView;
  accounts: AccountView[];
  onSubaccountChanged: (subaccount: SubaccountView) => void;
  onOpenInvite: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const teamLinks = useMemo(
    () => [...subaccount.teamLinks].sort((a, b) => accountDisplayName(accountById.get(a.accountId), a.accountId).localeCompare(accountDisplayName(accountById.get(b.accountId), b.accountId))),
    [accountById, subaccount.teamLinks]
  );
  const syncedAt = teamLinks.reduce<number | undefined>((latest, link) => (latest ? Math.max(latest, link.updatedAt) : link.updatedAt), undefined);

  const syncTeamLinks = async () => {
    setBusy('sync');
    setError('');
    try {
      onSubaccountChanged(await apiClient.syncSubaccountTeamLinks(subaccount.id));
    } catch (syncError) {
      setError((syncError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const columns: ColumnsType<SubaccountTeamLink> = [
    {
      title: 'Team',
      dataIndex: 'accountId',
      render: (accountId) => {
        const account = accountById.get(accountId);
        return (
          <div className="table-main-cell">
            <Typography.Text strong>{accountDisplayName(account, accountId)}</Typography.Text>
            <Typography.Text type="secondary">{account?.accountId || accountId}</Typography.Text>
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
    }
  ];

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">上次同步 {formatRelativeTime(syncedAt)}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} loading={busy === 'sync'} onClick={() => void syncTeamLinks()}>
            刷新关联
          </Button>
          <Button type="primary" icon={<LinkOutlined />} onClick={onOpenInvite}>
            邀请加入 Team
          </Button>
        </Space>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Table<SubaccountTeamLink>
        rowKey="accountId"
        columns={columns}
        dataSource={teamLinks}
        pagination={false}
        locale={{ emptyText: '暂无 Team 关联记录' }}
      />
    </Space>
  );
}
