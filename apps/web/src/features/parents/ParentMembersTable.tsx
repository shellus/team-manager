import { useMemo, useState } from 'react';
import type {
  AccountSeatSlot,
  AccountSeatSlotProfileInput,
  AccountView,
  EditableMemberRole,
  Member,
  PendingInvite,
  SeatType
} from '@team-manager/shared';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { apiClient } from '../../api.js';
import { ActionPopconfirm } from '../../components/ActionPopconfirm.js';
import { actionKey } from '../../components/actionBusy.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { SeatSlotStatusTag, SeatTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { roleLabel, SEAT_LABEL } from '../../labels.js';
import {
  SeatSlotProfileModal,
  normalizeSeatSlotEmail,
  seatSlotProfileSummary
} from './SeatSlotProfileModal.js';
import { buildParentMemberRows, type ParentMemberRow } from './parentMemberRows.js';
import { buildSeatManagementUrl } from './seatSlotUrl.js';
import { MemberRoleSelect } from './MemberRoleSelect.js';

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
  const lastRemoval = account.lastMemberRemoval;
  const rows = useMemo(() => buildParentMemberRows(account), [account]);
  const editingRow = rows.find((row) => row.email === normalizeSeatSlotEmail(editingEmail));
  const disconnectedCount = rows.filter((row) => row.relationStatus === 'unknown').length;

  const refreshRelations = async () => {
    setError('');
    try {
      await actionBusy.run('member-relations-refresh', async () => {
        onAccountChanged(await apiClient.refreshMembers(account.id));
        onAccountChanged(await apiClient.refreshPendingInvites(account.id));
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

  const revokeInvite = async (invite: PendingInvite) => {
    setError('');
    try {
      await actionBusy.run(actionKey('invite-revoke', invite.email), async () => {
        onAccountChanged(await apiClient.revokePendingInvite(account.id, invite.email));
      });
    } catch (revokeError) {
      setError((revokeError as Error).message);
    }
  };

  const releaseSlot = async (slot: AccountSeatSlot) => {
    setError('');
    try {
      await actionBusy.run(actionKey('seat-slot-release', slot.seatKey), async () => {
        onAccountChanged(await apiClient.releaseDisconnectedSeatSlot(account.id, slot.seatKey));
      });
    } catch (releaseError) {
      setError((releaseError as Error).message);
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

  const columns: ColumnsType<ParentMemberRow> = [
    {
      title: '账号',
      key: 'account',
      render: (_, row) => (
        <div className="table-main-cell">
          <Typography.Text strong>{row.email || '未绑定邮箱'}</Typography.Text>
          <Typography.Text type="secondary">
            {row.member?.remoteName || row.member?.userId
              || (row.invite ? `邀请创建 ${formatDateTime(row.invite.createdTime)}` : '本地客户席位')}
          </Typography.Text>
        </div>
      )
    },
    {
      title: '远端状态',
      dataIndex: 'relationStatus',
      width: 130,
      render: (status: ParentMemberRow['relationStatus']) => <SeatSlotStatusTag status={status} />
    },
    {
      title: '客户席位资料',
      key: 'profile',
      render: (_, row) => (
        <div className="profile-cell">
          <Typography.Text>{seatSlotProfileSummary(row.slot)}</Typography.Text>
          {row.slot?.remark && <Typography.Text type="secondary">{row.slot.remark}</Typography.Text>}
          {row.slot?.seatKey && (
            <Typography.Text type="secondary" copyable={{ text: buildSeatManagementUrl(row.slot.seatKey) }}>
              席位管理 URL
            </Typography.Text>
          )}
          {row.email && (
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingEmail(row.email!)}>
              编辑席位
            </Button>
          )}
        </div>
      )
    },
    {
      title: '角色',
      key: 'role',
      width: 170,
      render: (_, row) => row.member ? (
        <MemberRoleSelect
          currentRole={row.member.role}
          loading={actionBusy.isBusy(actionKey('member-role', row.member.userId))}
          onChange={(role) => changeRole(row.member!, role)}
        />
      ) : (
        <Typography.Text type={row.role ? undefined : 'secondary'}>
          {row.role ? roleLabel(row.role) : '—'}
        </Typography.Text>
      )
    },
    {
      title: '席位',
      key: 'seat',
      width: 190,
      render: (_, row) => row.member ? (
        <Select<SeatType>
          value={row.member.seat}
          options={[
            { value: 'usage_based', label: SEAT_LABEL.usage_based },
            { value: 'default', label: SEAT_LABEL.default }
          ]}
          loading={actionBusy.isBusy(actionKey('member-seat', row.member.userId))}
          disabled={actionBusy.isBusy(actionKey('member-seat', row.member.userId))}
          onChange={(seat) => void changeSeat(row.member!, seat)}
        />
      ) : <SeatTag seat={row.seat} />
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.member && (
            <ActionPopconfirm
              title="移除成员"
              description="成员会立即失去访问权限和相关凭证；标准 ChatGPT 席位仍可能临时计费，随后添加的新成员也可能形成独立付费席位。"
              okText="移除成员"
              cancelText="取消"
              loading={actionBusy.isBusy(actionKey('member-remove', row.member.userId))}
              okButtonProps={{ danger: true }}
              onConfirm={() => removeMember(row.member!)}
            >
              <Button danger icon={<DeleteOutlined />} size="small">移除</Button>
            </ActionPopconfirm>
          )}
          {row.invite && (
            <ActionPopconfirm
              title="撤销邀请"
              description={`撤销发给 ${row.invite.email} 的邀请。`}
              okText="撤销邀请"
              cancelText="取消"
              loading={actionBusy.isBusy(actionKey('invite-revoke', row.invite.email))}
              okButtonProps={{ danger: true }}
              onConfirm={() => revokeInvite(row.invite!)}
            >
              <Button danger icon={<DeleteOutlined />} size="small">撤销邀请</Button>
            </ActionPopconfirm>
          )}
          {!row.member && !row.invite && row.slot?.status === 'unknown' && (
            <ActionPopconfirm
              title={row.slot.seat === 'default' ? '释放为真正空位' : '结束客户席位'}
              description={`释放后将删除 ${row.email || '该席位'} 的本地客户资料、到期信息和换号历史。此操作不会调用 ChatGPT。`}
              okText={row.slot.seat === 'default' ? '释放为空位' : '结束客户席位'}
              cancelText="取消"
              loading={actionBusy.isBusy(actionKey('seat-slot-release', row.slot.seatKey))}
              okButtonProps={{ danger: true }}
              onConfirm={() => releaseSlot(row.slot!)}
            >
              <Button danger icon={<DeleteOutlined />} size="small">
                {row.slot.seat === 'default' ? '释放为空位' : '结束客户席位'}
              </Button>
            </ActionPopconfirm>
          )}
          {!row.member && !row.invite && row.slot?.status !== 'unknown' && (
            <Typography.Text type="secondary">无需处理</Typography.Text>
          )}
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={12} className="panel-stack">
      <div className="panel-toolbar">
        <Typography.Text type="secondary">
          成员缓存 {formatRelativeTime(account.membersCachedAt)} · 邀请缓存 {formatRelativeTime(account.pendingInvitesCachedAt)}
        </Typography.Text>
        <Button
          icon={<ReloadOutlined />}
          loading={actionBusy.isBusy('member-relations-refresh')}
          onClick={() => void refreshRelations()}
        >
          刷新成员与邀请
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {disconnectedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`发现 ${disconnectedCount} 个失联客户席位`}
          description="这些席位保留了客户资料，但成员和邀请中都找不到对应邮箱。确认不再使用后，可手动释放。"
        />
      )}
      {lastRemoval && (
        <Alert
          type={(lastRemoval.policyNotice?.billedSeatDelta ?? 0) > 0 || lastRemoval.billingNoticeJson ? 'warning' : 'info'}
          showIcon
          message={`最近移除成员：${lastRemoval.email ?? lastRemoval.userId}`}
          description={(
            <Space direction="vertical" size={2}>
              <Typography.Text>
                {lastRemoval.policyNotice?.kind
                  ? `上游策略：${lastRemoval.policyNotice.kind}`
                  : '上游未返回可识别的策略类型'}
                {lastRemoval.policyNotice?.billedSeatDelta !== undefined
                  ? `；计费席位变化：${lastRemoval.policyNotice.billedSeatDelta}`
                  : ''}
                {lastRemoval.policyNotice?.vacancyOrdinal !== undefined
                  ? `；空缺序号：${lastRemoval.policyNotice.vacancyOrdinal}`
                  : ''}
                {lastRemoval.policyNotice?.freeVacancyThreshold !== undefined
                  ? `；临时阈值：${lastRemoval.policyNotice.freeVacancyThreshold}`
                  : ''}
              </Typography.Text>
              {lastRemoval.billingNoticeJson && (
                <Typography.Text code copyable={{ text: lastRemoval.billingNoticeJson }}>
                  billing_notice: {lastRemoval.billingNoticeJson}
                </Typography.Text>
              )}
              {lastRemoval.policyNotice?.rawJson && (
                <Typography.Text code copyable={{ text: lastRemoval.policyNotice.rawJson }}>
                  policy_notice: {lastRemoval.policyNotice.rawJson}
                </Typography.Text>
              )}
            </Space>
          )}
        />
      )}
      <Table<ParentMemberRow>
        rowKey="key"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: '暂无成员、邀请或客户席位' }}
      />
      <SeatSlotProfileModal
        open={Boolean(editingEmail)}
        email={editingEmail}
        sourceLabel={editingRow?.member
          ? '成员'
          : editingRow?.invite
            ? '邀请待接受'
            : '客户席位'}
        account={account}
        confirmLoading={actionBusy.isBusy(actionKey('seat-slot-profile', normalizeSeatSlotEmail(editingEmail)))}
        onCancel={() => setEditingEmail('')}
        onSubmit={saveSeatSlotProfile}
      />
    </Space>
  );
}
