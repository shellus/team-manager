import { useMemo, useState } from 'react';
import type { AccountView, SeatType, SubaccountTeamLink, SubaccountView } from '@team-manager/shared';
import { LinkOutlined, LogoutOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { actionKey } from '../../components/actionBusy.js';
import { apiClient } from '../../api.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { SeatTag, TeamLinkStatusTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import {
  parseWorkspaceIds,
  visibleTeamLinks
} from './subaccountTeamLinks.js';

type K12JoinStatus = 'pending' | 'joining' | 'success' | 'error';

interface K12JoinJob {
  workspaceId: string;
  status: K12JoinStatus;
  message?: string;
}

function accountDisplayName(account: AccountView | undefined, fallback: string): string {
  if (!account) return fallback;
  return account.remark || account.workspaceName || account.email;
}

function teamLinkDisplayName(link: SubaccountTeamLink, account: AccountView | undefined): string {
  return accountDisplayName(account, link.workspaceName || link.workspaceId || link.accountId);
}

function teamLinkWorkspaceId(link: SubaccountTeamLink, account: AccountView | undefined): string {
  return link.workspaceId || account?.accountId || link.accountId;
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
  const actionBusy = useActionBusy();
  const [k12Input, setK12Input] = useState('');
  const [k12Jobs, setK12Jobs] = useState<K12JoinJob[]>([]);
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

  const updateK12Job = (workspaceId: string, patch: Partial<K12JoinJob>) => {
    setK12Jobs((current) => current.map((job) => (job.workspaceId === workspaceId ? { ...job, ...patch } : job)));
  };

  const joinK12Workspaces = async () => {
    const workspaceIds = parseWorkspaceIds(k12Input);
    if (!workspaceIds.length) {
      setError('请粘贴至少一个 K12 workspace UUID');
      return;
    }
    setError('');
    setK12Jobs(workspaceIds.map((workspaceId) => ({ workspaceId, status: 'pending' })));
    for (const workspaceId of workspaceIds) {
      updateK12Job(workspaceId, { status: 'joining', message: undefined });
      try {
        onSubaccountChanged(await apiClient.joinSubaccountK12Workspace(subaccount.id, workspaceId));
        updateK12Job(workspaceId, { status: 'success', message: '已提交加入请求' });
      } catch (joinError) {
        updateK12Job(workspaceId, { status: 'error', message: (joinError as Error).message });
      }
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
          <Button type="primary" icon={<LinkOutlined />} onClick={onOpenInvite}>
            邀请加入 Team
          </Button>
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
      <div className="subsection-panel">
        <Space direction="vertical" size={10} className="panel-stack">
          <Typography.Text strong>批量加入 K12 workspace</Typography.Text>
          <Input.TextArea
            rows={4}
            value={k12Input}
            spellCheck={false}
            placeholder="粘贴 K12 workspace UUID，支持每行一个或带名称的列表"
            onChange={(event) => setK12Input(event.target.value)}
          />
          <Button
            type="primary"
            icon={<LinkOutlined />}
            loading={k12Jobs.some((job) => job.status === 'joining')}
            onClick={() => void joinK12Workspaces()}
          >
            批量加入 K12
          </Button>
          {k12Jobs.length > 0 && (
            <Table<K12JoinJob>
              rowKey="workspaceId"
              size="small"
              pagination={false}
              dataSource={k12Jobs}
              columns={[
                {
                  title: 'workspace',
                  dataIndex: 'workspaceId'
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 120,
                  render: (status: K12JoinStatus) => {
                    if (status === 'joining') return <Tag color="processing">正在加入</Tag>;
                    if (status === 'success') return <Tag color="success">已提交</Tag>;
                    if (status === 'error') return <Tag color="error">失败</Tag>;
                    return <Tag>等待</Tag>;
                  }
                },
                {
                  title: '结果',
                  dataIndex: 'message',
                  render: (message?: string) => <Typography.Text type="secondary">{message || '-'}</Typography.Text>
                }
              ]}
            />
          )}
        </Space>
      </div>
    </Space>
  );
}
