import { useEffect, useMemo, useState } from 'react';
import type { EditableMemberRole, MemberRole } from '@team-manager/shared';
import { Popconfirm, Select } from 'antd';
import { editableMemberRoleOptions, memberRoleConfirmation } from '../../labels.js';

export function MemberRoleSelect({
  userId,
  currentRole,
  loading,
  onConfirm
}: {
  userId: string;
  currentRole: MemberRole;
  loading: boolean;
  onConfirm: (role: EditableMemberRole, confirmOwnerRisk: boolean) => Promise<void>;
}) {
  const [pendingRole, setPendingRole] = useState<EditableMemberRole>();
  const options = useMemo(() => editableMemberRoleOptions(currentRole), [currentRole]);
  const confirmation = pendingRole ? memberRoleConfirmation(currentRole, pendingRole) : undefined;

  useEffect(() => {
    setPendingRole(undefined);
  }, [currentRole, userId]);

  const confirm = async () => {
    if (!pendingRole || !confirmation) return;
    await onConfirm(pendingRole, confirmation.confirmOwnerRisk);
    setPendingRole(undefined);
  };

  return (
    <Popconfirm
      open={Boolean(pendingRole)}
      trigger={[]}
      title={confirmation?.title}
      description={confirmation?.description}
      okText="确认修改角色"
      cancelText="取消"
      okButtonProps={{ danger: confirmation?.danger, loading }}
      onConfirm={() => void confirm()}
      onCancel={() => setPendingRole(undefined)}
    >
      <Select<MemberRole>
        aria-label="成员角色"
        value={pendingRole ?? currentRole}
        options={options}
        loading={loading}
        disabled={loading}
        popupMatchSelectWidth={false}
        style={{ minWidth: 140 }}
        onChange={(role) => {
          if (role !== currentRole) setPendingRole(role as EditableMemberRole);
        }}
      />
    </Popconfirm>
  );
}
