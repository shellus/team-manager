import { useState } from 'react';
import type { AccountSeatSlotProfileInput, AccountView, PendingInvite } from '@team-manager/shared';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { ActionPopconfirm } from '../../components/ActionPopconfirm.js';
import { actionKey } from '../../components/actionBusy.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { SeatTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { roleLabel } from '../../labels.js';
import {
  SeatSlotProfileModal,
  normalizeSeatSlotEmail,
  seatSlotForEmail,
  seatSlotProfileSummary
} from './SeatSlotProfileModal.js';
import { buildSeatManagementUrl } from './seatSlotUrl.js';

export function ParentInvitesTable({
  account,
  onAccountChanged
}: {
  account: AccountView;
  onAccountChanged: (account: AccountView) => void;
}) {
  const [error, setError] = useState('');
  const [editingEmail, setEditingEmail] = useState('');
  const actionBusy = useActionBusy();
  const invites = account.pendingInvitesCache ?? [];

  const refreshInvites = async () => {
    setError('');
    try {
      await actionBusy.run('invites-refresh', async () => {
        onAccountChanged(await apiClient.refreshPendingInvites(account.id));
      });
    } catch (refreshError) {
      setError((refreshError as Error).message);
    }
  };

  const revokeInvite = async (invite: PendingInvite) => {
    const key = actionKey('invite-revoke', invite.email);
    setError('');
    try {
      await actionBusy.run(key, async () => {
        onAccountChanged(await apiClient.revokePendingInvite(account.id, invite.email));
      });
    } catch (revokeError) {
      setError((revokeError as Error).message);
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

  const columns: ColumnsType<PendingInvite> = [
    {
      title: '邮箱',
      dataIndex: 'email',
      render: (email) => <Typography.Text strong>{email}</Typography.Text>
    },
    {
      title: '客户席位资料',
      key: 'profile',
      render: (_, invite) => {
        const slot = seatSlotForEmail(account, invite.email);
        return (
          <div className="profile-cell">
            <Typography.Text>{seatSlotProfileSummary(slot)}</Typography.Text>
            {slot?.remark && <Typography.Text type="secondary">{slot.remark}</Typography.Text>}
            {slot?.seatKey && (
              <Typography.Text type="secondary" copyable={{ text: buildSeatManagementUrl(slot.seatKey) }}>
                席位管理 URL
              </Typography.Text>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingEmail(invite.email)}>
              编辑席位
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
        <ActionPopconfirm
          title="撤销邀请"
          description={`撤销发给 ${invite.email} 的 pending invite。`}
          okText="撤销邀请"
          cancelText="取消"
          loading={actionBusy.isBusy(actionKey('invite-revoke', invite.email))}
          okButtonProps={{ danger: true }}
          onConfirm={() => revokeInvite(invite)}
        >
          <Button danger icon={<DeleteOutlined />} size="small">
            撤销
          </Button>
        </ActionPopconfirm>
      )
    }
  ];

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">邀请缓存 {formatRelativeTime(account.pendingInvitesCachedAt)}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} loading={actionBusy.isBusy('invites-refresh')} onClick={() => void refreshInvites()}>
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
      <SeatSlotProfileModal
        open={Boolean(editingEmail)}
        email={editingEmail}
        sourceLabel="待处理邀请"
        account={account}
        confirmLoading={actionBusy.isBusy(actionKey('seat-slot-profile', normalizeSeatSlotEmail(editingEmail)))}
        onCancel={() => setEditingEmail('')}
        onSubmit={saveSeatSlotProfile}
      />
    </Space>
  );
}
