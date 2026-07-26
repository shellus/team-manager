import { useMemo, useState } from 'react';
import type {
  AccountSeatSlotProfileInput,
  AccountView,
  EditableMemberRole,
  Member,
  SeatType
} from '@team-manager/shared';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { ActionPopconfirm } from '../../components/ActionPopconfirm.js';
import { actionKey } from '../../components/actionBusy.js';
import { formatRelativeTime } from '../../components/format.js';
import { SeatTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { SEAT_LABEL } from '../../labels.js';
import {
  SeatSlotProfileModal,
  normalizeSeatSlotEmail,
  seatSlotForEmail,
  seatSlotProfileSummary
} from './SeatSlotProfileModal.js';
import { buildSeatManagementUrl } from './seatSlotUrl.js';
import { MemberRoleSelect } from './MemberRoleSelect.js';

function memberRoleRank(member: Member): number {
  return member.role === 'account-owner' ? 0 : 1;
}

export function ParentMembersTable({
  account,
  onAccountChanged
}: {
  account: AccountView;
  onAccountChanged: (account: AccountView) => void;
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

  const changeSeat = async (member: Member, seat: SeatType) => {
    const key = actionKey('member-seat', member.userId);
    actionBusy.start(key);
    setError('');
    try {
      onAccountChanged(await apiClient.setMemberSeat(account.id, member.userId, seat));
    } catch (seatError) {
      setError((seatError as Error).message);
    } finally {
      actionBusy.finish(key);
    }
  };

  const changeRole = async (member: Member, role: EditableMemberRole) => {
    const key = actionKey('member-role', member.userId);
    setError('');
    try {
      await actionBusy.run(key, async () => {
        onAccountChanged(await apiClient.setMemberRole(account.id, member.userId, role));
      });
    } catch (roleError) {
      setError((roleError as Error).message);
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

  const saveSeatSlotProfile = async (email: string, input: AccountSeatSlotProfileInput) => {
    const key = normalizeSeatSlotEmail(email);
    setError('');
    try {
      await actionBusy.run(actionKey('seat-slot-profile', key), async () => {
        onAccountChanged(await apiClient.updateSeatSlotProfile(account.id, { email, ...input }));
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
      title: '客户席位资料',
      key: 'profile',
      render: (_, member) => {
        const slot = seatSlotForEmail(account, member.email);
        return (
          <div className="profile-cell">
            <Typography.Text>{seatSlotProfileSummary(slot)}</Typography.Text>
            {slot?.remark && <Typography.Text type="secondary">{slot.remark}</Typography.Text>}
            {slot?.seatKey && (
              <Typography.Text type="secondary" copyable={{ text: buildSeatManagementUrl(slot.seatKey) }}>
                席位管理 URL
              </Typography.Text>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingEmail(member.email)}>
              编辑席位
            </Button>
          </div>
        );
      }
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 180,
      render: (_, member) => (
        <MemberRoleSelect
          currentRole={member.role}
          loading={actionBusy.isBusy(actionKey('member-role', member.userId))}
          onChange={(role) => changeRole(member, role)}
        />
      )
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
      <SeatSlotProfileModal
        open={Boolean(editingEmail)}
        email={editingEmail}
        sourceLabel="成员列表"
        account={account}
        confirmLoading={actionBusy.isBusy(actionKey('seat-slot-profile', normalizeSeatSlotEmail(editingEmail)))}
        onCancel={() => setEditingEmail('')}
        onSubmit={saveSeatSlotProfile}
      />
    </Space>
  );
}
