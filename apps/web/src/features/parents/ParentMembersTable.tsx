import { useMemo, useState } from 'react';
import type { AccountView, Member, SeatType } from '@team-manager/shared';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { formatRelativeTime, isBillingRiskError } from '../../components/format.js';
import { SeatTag } from '../../components/StatusTag.js';
import { roleLabel, SEAT_LABEL } from '../../labels.js';

export interface MemberSeatRisk {
  kind: 'member-seat';
  userId: string;
  email: string;
  seat: SeatType;
}

export function ParentMembersTable({
  account,
  onAccountChanged,
  onBillingRisk
}: {
  account: AccountView;
  onAccountChanged: (account: AccountView) => void;
  onBillingRisk: (risk: MemberSeatRisk) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const members = account.membersCache ?? [];

  const refreshMembers = async () => {
    setBusy('refresh');
    setError('');
    try {
      onAccountChanged(await apiClient.refreshMembers(account.id));
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const changeSeat = async (member: Member, seat: SeatType, confirmBillingRisk = false) => {
    setBusy(`seat-${member.userId}`);
    setError('');
    try {
      onAccountChanged(await apiClient.setMemberSeat(account.id, member.userId, seat, confirmBillingRisk));
    } catch (seatError) {
      if (isBillingRiskError(seatError)) {
        onBillingRisk({ kind: 'member-seat', userId: member.userId, email: member.email, seat });
      } else {
        setError((seatError as Error).message);
      }
    } finally {
      setBusy('');
    }
  };

  const removeMember = async (member: Member) => {
    setBusy(`remove-${member.userId}`);
    setError('');
    try {
      onAccountChanged(await apiClient.removeMember(account.id, member.userId));
    } catch (removeError) {
      setError((removeError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const columns = useMemo<ColumnsType<Member>>(
    () => [
      {
        title: '成员',
        dataIndex: 'email',
        render: (_, member) => (
          <div className="table-main-cell">
            <Typography.Text strong>{member.email}</Typography.Text>
            <Typography.Text type="secondary">{member.name || member.userId}</Typography.Text>
          </div>
        )
      },
      {
        title: '角色',
        dataIndex: 'role',
        width: 130,
        render: (role) => roleLabel(role)
      },
      {
        title: '席位',
        dataIndex: 'seat',
        width: 190,
        render: (_, member) => (
          <Select<SeatType>
            value={member.seat}
            options={[
              { value: 'usage_based', label: SEAT_LABEL.usage_based },
              { value: 'default', label: SEAT_LABEL.default }
            ]}
            disabled={busy === `seat-${member.userId}`}
            onChange={(seat) => void changeSeat(member, seat)}
          />
        )
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 120,
        render: (_, member) => <SeatTag seat={member.seat} />
      },
      {
        title: '操作',
        key: 'actions',
        width: 110,
        render: (_, member) => (
          <Popconfirm
            title="移除成员"
            description="移除成员可能导致该 Team 下的凭证不可用。"
            okText="移除成员"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: busy === `remove-${member.userId}` }}
            onConfirm={() => void removeMember(member)}
          >
            <Button danger icon={<DeleteOutlined />} size="small">
              移除
            </Button>
          </Popconfirm>
        )
      }
    ],
    [busy]
  );

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">成员缓存 {formatRelativeTime(account.membersCachedAt)}</Typography.Text>
        <Button icon={<ReloadOutlined />} loading={busy === 'refresh'} onClick={() => void refreshMembers()}>
          刷新成员
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Table<Member>
        rowKey="userId"
        columns={columns}
        dataSource={members}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: '暂无成员缓存，点击刷新成员获取最新列表' }}
      />
    </Space>
  );
}
