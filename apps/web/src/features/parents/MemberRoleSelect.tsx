import { useMemo } from 'react';
import type { EditableMemberRole, MemberRole } from '@team-manager/shared';
import { Select } from 'antd';
import { editableMemberRoleOptions } from '../../labels.js';

export function MemberRoleSelect({
  currentRole,
  loading,
  onChange
}: {
  currentRole: MemberRole;
  loading: boolean;
  onChange: (role: EditableMemberRole) => Promise<void>;
}) {
  const options = useMemo(() => editableMemberRoleOptions(currentRole), [currentRole]);

  return (
    <Select<MemberRole>
      aria-label="成员角色"
      value={currentRole}
      options={options}
      loading={loading}
      disabled={loading}
      popupMatchSelectWidth={false}
      style={{ minWidth: 140 }}
      onChange={(role) => {
        if (role !== currentRole) void onChange(role as EditableMemberRole);
      }}
    />
  );
}
