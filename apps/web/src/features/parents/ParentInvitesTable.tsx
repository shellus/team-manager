import { useState } from 'react';
import type { AccountMemberProfileInput, AccountView, PendingInvite } from '@team-manager/shared';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Popconfirm, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { SeatTag } from '../../components/StatusTag.js';
import { roleLabel } from '../../labels.js';
import {
  MemberProfileModal,
  memberProfileForEmail,
  memberProfileSummary,
  normalizeMemberProfileEmail
} from './MemberProfileModal.js';
import { buildSeatManagementUrl } from './seatSlotUrl.js';

export function ParentInvitesTable({
  account,
  onAccountChanged
}: {
  account: AccountView;
  onAccountChanged: (account: AccountView) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editingEmail, setEditingEmail] = useState('');
  const invites = account.pendingInvitesCache ?? [];

  const refreshInvites = async () => {
    setBusy('refresh');
    setError('');
    try {
      onAccountChanged(await apiClient.refreshPendingInvites(account.id));
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const revokeInvite = async (invite: PendingInvite) => {
    setBusy(`revoke-${invite.email}`);
    setError('');
    try {
      onAccountChanged(await apiClient.revokePendingInvite(account.id, invite.email));
    } catch (revokeError) {
      setError((revokeError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const saveProfile = async (email: string, input: AccountMemberProfileInput) => {
    const key = normalizeMemberProfileEmail(email);
    setBusy(`profile-${key}`);
    setError('');
    try {
      onAccountChanged(await apiClient.updateMemberProfile(account.id, { email, ...input }));
      setEditingEmail('');
    } catch (profileError) {
      setError((profileError as Error).message);
    } finally {
      setBusy('');
    }
  };

  const columns: ColumnsType<PendingInvite> = [
    {
      title: '邮箱',
      dataIndex: 'email',
      render: (email) => <Typography.Text strong>{email}</Typography.Text>
    },
    {
      title: '本地资料',
      key: 'profile',
      render: (_, invite) => {
        const profile = memberProfileForEmail(account, invite.email);
        return (
          <div className="profile-cell">
            <Typography.Text>{memberProfileSummary(profile)}</Typography.Text>
            {profile?.remark && <Typography.Text type="secondary">{profile.remark}</Typography.Text>}
            {profile?.seatKey && (
              <Typography.Text type="secondary" copyable={{ text: buildSeatManagementUrl(profile.seatKey) }}>
                席位管理 URL
              </Typography.Text>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingEmail(invite.email)}>
              编辑资料
            </Button>
          </div>
        );
      }
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 120,
      render: (role) => roleLabel(role)
    },
    {
      title: '席位',
      dataIndex: 'seat',
      width: 150,
      render: (seat) => <SeatTag seat={seat} />
    },
    {
      title: '创建时间',
      dataIndex: 'createdTime',
      width: 190,
      render: (value) => formatDateTime(value)
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (_, invite) => (
        <Popconfirm
          title="撤销邀请"
          description={`撤销发给 ${invite.email} 的 pending invite。`}
          okText="撤销邀请"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: busy === `revoke-${invite.email}` }}
          onConfirm={() => void revokeInvite(invite)}
        >
          <Button danger icon={<DeleteOutlined />} size="small">
            撤销
          </Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">邀请缓存 {formatRelativeTime(account.pendingInvitesCachedAt)}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} loading={busy === 'refresh'} onClick={() => void refreshInvites()}>
            刷新邀请
          </Button>
        </Space>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Table<PendingInvite>
        rowKey="inviteId"
        columns={columns}
        dataSource={invites}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: '暂无 pending invite' }}
      />
      <MemberProfileModal
        open={Boolean(editingEmail)}
        email={editingEmail}
        sourceLabel="待处理邀请"
        account={account}
        confirmLoading={busy === `profile-${normalizeMemberProfileEmail(editingEmail)}`}
        onCancel={() => setEditingEmail('')}
        onSubmit={saveProfile}
      />
    </Space>
  );
}
