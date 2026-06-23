import { useEffect, useMemo, useState } from 'react';
import type { AccountLimitType, AccountMemberProfileInput, AccountView, SeatType } from '@team-manager/shared';
import { Alert, Button, Form, Input, Modal, Select, Space, Switch } from 'antd';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import {
  clearModalState,
  parseParentSearchState,
  setModalState,
  setSearchValue,
  type ParentModal,
  type ParentTab
} from '../../app/routeState.js';
import { BillingRiskModal } from '../../components/BillingRiskModal.js';
import { isBillingRiskError } from '../../components/format.js';
import { JsonImportModal } from '../../components/JsonImportModal.js';
import { LocalProfileModal } from '../../components/LocalProfileModal.js';
import { SEAT_LABEL } from '../../labels.js';
import { defaultMemberProfileExpiresOn } from './MemberProfileModal.js';
import { ParentDetail } from './ParentDetail.js';
import { ParentList } from './ParentList.js';
import type { MemberSeatRisk } from './ParentMembersTable.js';

type ParentBillingRisk =
  | MemberSeatRisk
  | { kind: 'invite'; email: string; seat: SeatType; memberProfile: AccountMemberProfileInput };

interface InviteValues {
  email: string;
  seat: SeatType;
  note?: string;
  expiresOn: string;
  expireRemove: boolean;
  expireReminder: boolean;
}

function toSearch(params: URLSearchParams): string {
  const value = params.toString();
  return value ? `?${value}` : '';
}

function groupNameOf(account: AccountView): string {
  return account.groupName || '默认分组';
}

const accountSortCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function compareAccountSortName(a: AccountView, b: AccountView): number {
  return accountSortCollator.compare(
    a.note || a.email,
    b.note || b.email
  );
}

function searchableAccountText(account: AccountView): string {
  const values = [
    account.email,
    account.note,
    account.groupName,
    account.workspaceName,
    account.accountId,
    ...(account.membersCache ?? []).flatMap((member) => [member.email, member.name, member.role]),
    ...(account.pendingInvitesCache ?? []).flatMap((invite) => [invite.email, invite.role]),
    ...Object.values(account.memberProfiles ?? {}).flatMap((profile) => [
      profile.email,
      profile.note,
      profile.expiresOn
    ])
  ];
  return values.filter(Boolean).join('\n').toLowerCase();
}

function accountMatchesQuery(account: AccountView, query: string): boolean {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchableAccountText(account);
  return terms.every((term) => haystack.includes(term));
}

function defaultInviteValues(defaultSeat?: SeatType): InviteValues {
  return {
    email: '',
    seat: defaultSeat ?? 'usage_based',
    note: '',
    expiresOn: defaultMemberProfileExpiresOn(),
    expireRemove: false,
    expireReminder: true
  };
}

function profileFromInviteValues(values: InviteValues): AccountMemberProfileInput {
  return {
    note: values.note?.trim() ?? '',
    expiresOn: values.expiresOn,
    expireRemove: values.expireRemove,
    expireReminder: values.expireReminder
  };
}

export function ParentRoutes({
  accounts,
  loading,
  globalError,
  syncingIds,
  onAccountChanged,
  onAccountRemoved,
  onRefreshAccount,
  onError
}: {
  accounts: AccountView[];
  loading: boolean;
  globalError: string;
  syncingIds: Set<string>;
  onAccountChanged: (account: AccountView) => void;
  onAccountRemoved: (id: string) => void;
  onRefreshAccount: (account: AccountView) => void;
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { accountId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = parseParentSearchState(searchParams);
  const [inviteForm] = Form.useForm<InviteValues>();
  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');
  const [billingRisk, setBillingRisk] = useState<ParentBillingRisk | null>(null);
  const searchQuery = searchParams.get('q')?.trim() ?? '';
  const filteredAccounts = useMemo(
    () => accounts.filter((account) => accountMatchesQuery(account, searchQuery)).sort(compareAccountSortName),
    [accounts, searchQuery]
  );

  const groups = useMemo(() => {
    const countByGroup = new Map<string, number>();
    for (const account of filteredAccounts) countByGroup.set(groupNameOf(account), (countByGroup.get(groupNameOf(account)) ?? 0) + 1);
    return [...countByGroup.entries()].map(([name, count]) => ({ name, count }));
  }, [filteredAccounts]);
  const activeGroup = groups.some((group) => group.name === searchState.group)
    ? searchState.group
    : groups[0]?.name || '';
  const visibleAccounts = useMemo(
    () => filteredAccounts.filter((account) => groupNameOf(account) === activeGroup),
    [filteredAccounts, activeGroup]
  );
  const selected = visibleAccounts.find((account) => account.id === accountId) ?? visibleAccounts[0] ?? null;

  useEffect(() => {
    if (loading || accounts.length === 0) return;
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;
    if (activeGroup && searchState.group !== activeGroup) {
      nextParams.set('group', activeGroup);
      changed = true;
    }
    if (!searchParams.get('tab')) {
      nextParams.set('tab', searchState.tab);
      changed = true;
    }
    const nextPath = selected ? `/parents/${selected.id}` : '/parents';
    if (location.pathname !== nextPath || changed) {
      navigate({ pathname: nextPath, search: toSearch(nextParams) }, { replace: true });
    }
  }, [accounts.length, activeGroup, loading, location.pathname, navigate, searchParams, searchState.group, searchState.tab, selected]);

  useEffect(() => {
    if (searchState.modal === 'invite-member') {
      inviteForm.setFieldsValue(defaultInviteValues(selected?.defaultSeat));
    }
  }, [inviteForm, searchState.modal, selected?.defaultSeat]);

  const closeModal = () => {
    const next = clearModalState(searchParams);
    next.delete('seat');
    next.delete('risk');
    setSearchParams(next);
    setBillingRisk(null);
    setLocalError('');
  };

  const openModal = (modal: ParentModal, target = '') => {
    setSearchParams(setModalState(searchParams, modal, target));
  };

  const openBillingRisk = (risk: ParentBillingRisk) => {
    const next = setModalState(
      searchParams,
      'billing-risk',
      risk.kind === 'invite' ? risk.email : risk.userId
    );
    next.set('risk', risk.kind);
    next.set('seat', risk.seat);
    setBillingRisk(risk);
    setSearchParams(next);
  };

  const reportLocalError = (error: unknown) => {
    setLocalError((error as Error).message);
    onError(error);
  };

  const importParent = async (payload: Record<string, unknown>) => {
    setBusy('import-parent');
    setLocalError('');
    try {
      const account = await apiClient.addAccount(payload);
      onAccountChanged(account);
      const next = new URLSearchParams();
      next.set('group', groupNameOf(account));
      next.set('tab', 'members');
      navigate({ pathname: `/parents/${account.id}`, search: toSearch(next) });
    } catch (error) {
      reportLocalError(error);
      throw error;
    } finally {
      setBusy('');
    }
  };

  const deleteParent = async () => {
    if (!selected) return;
    setBusy('delete-parent');
    setLocalError('');
    try {
      await apiClient.removeAccount(selected.id);
      onAccountRemoved(selected.id);
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const updateLocalProfile = async (payload: {
    note?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    session?: Record<string, unknown>;
  }) => {
    if (!selected) return;
    setBusy('edit-parent-profile');
    setLocalError('');
    try {
      const updated = await apiClient.updateAccountLocalProfile(selected.id, payload);
      onAccountChanged(updated);
      const next = setSearchValue(clearModalState(searchParams), 'group', groupNameOf(updated));
      navigate({ pathname: `/parents/${updated.id}`, search: toSearch(next) }, { replace: true });
      setBillingRisk(null);
      setLocalError('');
    } catch (error) {
      reportLocalError(error);
      throw error;
    } finally {
      setBusy('');
    }
  };

  const submitInvite = async (values: InviteValues, confirmBillingRisk = false) => {
    if (!selected) return;
    const email = values.email.trim();
    const memberProfile = profileFromInviteValues(values);
    setBusy('invite-member');
    setLocalError('');
    try {
      const updated = await apiClient.invite(selected.id, email, values.seat, memberProfile, confirmBillingRisk);
      onAccountChanged(updated);
      inviteForm.resetFields();
      closeModal();
    } catch (error) {
      if (isBillingRiskError(error)) {
        openBillingRisk({ kind: 'invite', email, seat: values.seat, memberProfile });
      } else {
        reportLocalError(error);
      }
    } finally {
      setBusy('');
    }
  };

  const confirmBillingRisk = async () => {
    if (!selected || !billingRisk) {
      closeModal();
      return;
    }
    setBusy('billing-risk');
    setLocalError('');
    try {
      const updated =
        billingRisk.kind === 'invite'
          ? await apiClient.invite(
              selected.id,
              billingRisk.email,
              billingRisk.seat,
              billingRisk.memberProfile,
              true
            )
          : await apiClient.setMemberSeat(selected.id, billingRisk.userId, billingRisk.seat, true);
      onAccountChanged(updated);
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const changeGroup = (group: string) => {
    const firstInGroup = accounts.find((account) => groupNameOf(account) === group);
    const next = setSearchValue(searchParams, 'group', group);
    next.set('tab', searchState.tab);
    navigate({ pathname: firstInGroup ? `/parents/${firstInGroup.id}` : '/parents', search: toSearch(next) });
  };

  const selectAccount = (account: AccountView) => {
    const next = setSearchValue(searchParams, 'group', groupNameOf(account));
    navigate({ pathname: `/parents/${account.id}`, search: toSearch(next) });
  };

  const changeSearchQuery = (query: string) => {
    const next = setSearchValue(searchParams, 'q', query.trim());
    next.set('tab', searchState.tab);
    setSearchParams(next);
  };

  const changeTab = (tab: ParentTab) => {
    setSearchParams(setSearchValue(searchParams, 'tab', tab));
  };

  return (
    <div className="workbench">
      <ParentList
        groups={groups}
        activeGroup={activeGroup}
        accounts={visibleAccounts}
        totalCount={accounts.length}
        searchQuery={searchQuery}
        selectedId={selected?.id ?? ''}
        syncingIds={syncingIds}
        onGroupChange={changeGroup}
        onSearchChange={changeSearchQuery}
        onSelect={selectAccount}
        onRefreshAccount={onRefreshAccount}
        onOpenDelete={(account) => {
          selectAccount(account);
          openModal('delete-parent', account.id);
        }}
      />

      <Space direction="vertical" size={12} className="content-pane">
        {(globalError || localError) && <Alert type="error" showIcon message={localError || globalError} />}
        <ParentDetail
          account={selected}
          activeTab={searchState.tab}
          syncing={selected ? syncingIds.has(selected.id) : false}
          onTabChange={changeTab}
          onSync={() => selected && onRefreshAccount(selected)}
          onOpenInvite={() => openModal('invite-member', selected?.id ?? '')}
          onOpenDelete={() => selected && openModal('delete-parent', selected.id)}
          onOpenLocalProfile={() => selected && openModal('edit-parent-profile', selected.id)}
          onAccountChanged={onAccountChanged}
          onBillingRisk={openBillingRisk}
        />
      </Space>

      <JsonImportModal
        open={searchState.modal === 'import-parent'}
        mode="session"
        title="录入母号 Session"
        description="保存后先创建本地记录，ChatGPT 状态在母号详情中手动同步。"
        submitLabel="保存母号"
        confirmLoading={busy === 'import-parent'}
        onCancel={closeModal}
        onSubmit={importParent}
      />

      <LocalProfileModal
        open={searchState.modal === 'edit-parent-profile' && Boolean(selected)}
        mode="parent"
        title="编辑母号本地资料"
        description="只更新本系统内的备注、分组、限额类型和 session，不修改远端 Team 名称。"
        initialValues={{
          note: selected?.note ?? '',
          groupName: selected?.groupName || '默认分组',
          limitType: selected?.limitType ?? 'unknown'
        }}
        confirmLoading={busy === 'edit-parent-profile'}
        onCancel={closeModal}
        onSubmit={updateLocalProfile}
      />

      <Modal
        open={searchState.modal === 'delete-parent' && Boolean(selected)}
        title="删除母号"
        okText="删除母号"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: busy === 'delete-parent' }}
        onOk={() => void deleteParent()}
        onCancel={closeModal}
      >
        确认删除 {selected?.email} 的本地记录？远端 Team 不会被删除。
      </Modal>

      <Modal
        open={searchState.modal === 'invite-member' && Boolean(selected)}
        title="邀请成员"
        okText="发送邀请"
        cancelText="取消"
        confirmLoading={busy === 'invite-member'}
        onOk={() => inviteForm.submit()}
        onCancel={closeModal}
        destroyOnClose
      >
        <Form<InviteValues>
          form={inviteForm}
          layout="vertical"
          initialValues={defaultInviteValues(selected?.defaultSeat)}
          onFinish={(values) => void submitInvite(values)}
        >
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="成员邮箱" />
          </Form.Item>
          <Form.Item name="seat" label="席位类型" rules={[{ required: true, message: '请选择席位类型' }]}>
            <Select<SeatType>
              options={[
                { value: 'usage_based', label: SEAT_LABEL.usage_based },
                { value: 'default', label: SEAT_LABEL.default }
              ]}
            />
          </Form.Item>
          <Form.Item name="note" label="备注文本">
            <Input placeholder="例如客户名、用途或订单备注" />
          </Form.Item>
          <Form.Item name="expiresOn" label="到期时间" rules={[{ required: true, message: '请选择到期时间' }]}>
            <Input type="date" />
          </Form.Item>
          <div className="form-grid two">
            <Form.Item name="expireReminder" label="到期提醒" valuePropName="checked">
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
            <Form.Item name="expireRemove" label="到期移除" valuePropName="checked">
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <BillingRiskModal
        open={searchState.modal === 'billing-risk'}
        confirmLoading={busy === 'billing-risk'}
        onCancel={closeModal}
        onConfirm={() => void confirmBillingRisk()}
      />

      <Button className="floating-primary-action" type="primary" onClick={() => openModal('import-parent')}>
        录入母号
      </Button>
    </div>
  );
}
