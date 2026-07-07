import { useMemo, useState } from 'react';
import type { AccountMemberProfileInput, AccountView, Member, SeatType } from '@team-manager/shared';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { ActionPopconfirm } from '../../components/ActionPopconfirm.js';
import { actionKey } from '../../components/actionBusy.js';
import { formatRelativeTime, isBillingRiskError } from '../../components/format.js';
import { SeatTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { roleLabel, SEAT_LABEL } from '../../labels.js';
import {
  MemberProfileModal,
  memberProfileForEmail,
  memberProfileSummary,
  normalizeMemberProfileEmail
} from './MemberProfileModal.js';
import { buildSeatManagementUrl } from './seatSlotUrl.js';

function memberRoleRank(member: Member): number {
  return member.role === 'account-owner' ? 0 : 1;
}

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
  const [editingEmail, setEditingEmail] = useState('');
  const actionBusy = useActionBusy();
  const members = useMemo(
    () => (account.membersCache ?? []).map((member, index) => ({ member, index }))
      .sort((a, b) => memberRoleRank(a.member) - memberRoleRank(b.member) || a.index - b.index)
      .map((item) => item.member),
    [account.membersCache]
  );

  const refreshMembers = async () => {
    setError('');
    try {
      await actionBusy.run('members-refresh', async () => {
        onAccountChanged(await apiClient.refreshMembers(account.id));
      });
    } catch (refreshError) {
      setError((refreshError as Error).message);
    }
  };

  const changeSeat = async (member: Member, seat: SeatType, confirmBillingRisk = false) => {
    const key = actionKey('member-seat', member.userId);
    actionBusy.start(key);
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
      actionBusy.finish(key);
    }
  };

  const removeMember = async (member: Member) => {
    setError('');
    try {
      await actionBusy.run(actionKey('member-remove', member.userId), async () => {
        onAccountChanged(await apiClient.removeMember(account.id, member.userId));
      });
    } catch (removeError) {
      setError((removeError as Error).message);
    }
  };

  const saveProfile = async (email: string, input: AccountMemberProfileInput) => {
    const key = normalizeMemberProfileEmail(email);
    setError('');
    try {
      await actionBusy.run(actionKey('member-profile', key), async () => {
        onAccountChanged(await apiClient.updateMemberProfile(account.id, { email, ...input }));
        setEditingEmail('');
      });
    } catch (profileError) {
      setError((profileError as Error).message);
      throw profileError;
    }
  };

  const columns: ColumnsType<Member> = [
    {
      title: '成员',
      dataIndex: 'email',
      render: (_, member) => (
        <div className="table-main-cell">
          <Typography.Text strong>{member.email}</Typography.Text>
          <Typography.Text type="secondary">{member.remoteName || member.userId}</Typography.Text>
        </div>
      )
    },
    {
      title: '本地资料',
      key: 'profile',
      render: (_, member) => {
        const profile = memberProfileForEmail(account, member.email);
        return (
          <div className="profile-cell">
            <Typography.Text>{memberProfileSummary(profile)}</Typography.Text>
            {profile?.remark && <Typography.Text type="secondary">{profile.remark}</Typography.Text>}
            {profile?.seatKey && (
              <Typography.Text type="secondary" copyable={{ text: buildSeatManagementUrl(profile.seatKey) }}>
                席位管理 URL
              </Typography.Text>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingEmail(member.email)}>
              编辑资料
            </Button>
          </div>
        );
      }
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
          loading={actionBusy.isBusy(actionKey('member-seat', member.userId))}
          disabled={actionBusy.isBusy(actionKey('member-seat', member.userId))}
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
        <ActionPopconfirm
          title="移除成员"
          description="移除成员可能导致该 Team 下的凭证不可用。"
          okText="移除成员"
          cancelText="取消"
          loading={actionBusy.isBusy(actionKey('member-remove', member.userId))}
          okButtonProps={{ danger: true }}
          onConfirm={() => removeMember(member)}
        >
          <Button danger icon={<DeleteOutlined />} size="small">
            移除
          </Button>
        </ActionPopconfirm>
      )
    }
  ];

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">成员缓存 {formatRelativeTime(account.membersCachedAt)}</Typography.Text>
        <Button icon={<ReloadOutlined />} loading={actionBusy.isBusy('members-refresh')} onClick={() => void refreshMembers()}>
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
      <MemberProfileModal
        open={Boolean(editingEmail)}
        email={editingEmail}
        sourceLabel="成员列表"
        account={account}
        confirmLoading={actionBusy.isBusy(actionKey('member-profile', normalizeMemberProfileEmail(editingEmail)))}
        onCancel={() => setEditingEmail('')}
        onSubmit={saveProfile}
      />
    </Space>
  );
}
