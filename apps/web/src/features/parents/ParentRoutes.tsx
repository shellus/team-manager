import { useEffect, useMemo, useState } from 'react';
import type { AccountLimitType, AccountSeatSlotProfileInput, AccountView, SeatType } from '@team-manager/shared';
import { Alert, Button, Form, Input, Modal, Select, Space } from 'antd';
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
import { LocalProfileModal } from '../../components/LocalProfileModal.js';
import { ModalErrorAlert } from '../../components/ModalErrorAlert.js';
import { compareRecordSortName } from '../../components/recordSort.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { SEAT_LABEL } from '../../labels.js';
import { defaultSeatSlotExpiresOn, SeatSlotProfileFields } from './SeatSlotProfileModal.js';
import { ParentDetail } from './ParentDetail.js';
import { ParentList } from './ParentList.js';
import type { MemberSeatRisk } from './ParentMembersTable.js';
import {
  ALL_PARENT_GROUP,
  countParentGroups,
  filterParentsByGroup,
  parentGroupName,
  resolveParentGroup
} from './parentGroups.js';

type ParentBillingRisk =
  | MemberSeatRisk
  | { kind: 'invite'; email: string; seat: SeatType; seatSlotProfile?: AccountSeatSlotProfileInput };

interface InviteValues {
  email: string;
  seat: SeatType;
  remark?: string;
  expiresOn: string;
  expireRemove: boolean;
  expireReminder: boolean;
}

function toSearch(params: URLSearchParams): string {
  const value = params.toString();
  return value ? `?${value}` : '';
}

function searchableAccountText(account: AccountView): string {
  const values = [
    account.email,
    account.remark,
    account.groupName,
    account.workspaceName,
    account.accountId,
    account.nextRenewalOn,
    ...(account.membersCache ?? []).flatMap((member) => [member.email, member.remoteName, member.role]),
    ...(account.pendingInvitesCache ?? []).flatMap((invite) => [invite.email, invite.role]),
    ...(account.seatSlots ?? []).flatMap((slot) => [
      slot.email,
      slot.remark,
      slot.expiresOn,
      slot.price,
      slot.seatKey
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
    remark: '',
    expiresOn: defaultSeatSlotExpiresOn(),
    expireRemove: false,
    expireReminder: true
  };
}

function seatSlotProfileFromInviteValues(values: InviteValues): AccountSeatSlotProfileInput | undefined {
  if (values.seat !== 'default') return undefined;
  return {
    remark: values.remark?.trim() ?? '',
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
  const [localError, setLocalError] = useState('');
  const [billingRisk, setBillingRisk] = useState<ParentBillingRisk | null>(null);
  const actionBusy = useActionBusy();
  const searchQuery = searchParams.get('q')?.trim() ?? '';
  const filteredAccounts = useMemo(
    () => accounts.filter((account) => accountMatchesQuery(account, searchQuery)).sort(compareRecordSortName),
    [accounts, searchQuery]
  );

  const groups = useMemo(() => {
    return countParentGroups(filteredAccounts);
  }, [filteredAccounts]);
  const activeGroup = resolveParentGroup(searchState.group, groups);
  const visibleAccounts = useMemo(
    () => filterParentsByGroup(filteredAccounts, activeGroup),
    [filteredAccounts, activeGroup]
  );
  const selected = visibleAccounts.find((account) => account.id === accountId) ?? visibleAccounts[0] ?? null;

  useEffect(() => {
    if (loading || accounts.length === 0) return;
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;
    if (searchState.group !== activeGroup) {
      if (activeGroup === ALL_PARENT_GROUP) nextParams.delete('group');
      else nextParams.set('group', activeGroup);
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
    setLocalError('');
    setSearchParams(setModalState(searchParams, modal, target));
  };

  const openBillingRisk = (risk: ParentBillingRisk) => {
    setLocalError('');
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

  const importParent = async (payload: unknown) => {
    setLocalError('');
    try {
      await actionBusy.run('import-parent', async () => {
        const account = await apiClient.addAccount(payload as Record<string, unknown>);
        onAccountChanged(account);
        const next = new URLSearchParams();
        next.set('group', parentGroupName(account));
        next.set('tab', 'members');
        navigate({ pathname: `/parents/${account.id}`, search: toSearch(next) });
      });
    } catch (error) {
      reportLocalError(error);
      throw error;
    }
  };

  const deleteParent = async () => {
    if (!selected) return;
    setLocalError('');
    try {
      await actionBusy.run('delete-parent', async () => {
        await apiClient.removeAccount(selected.id);
        onAccountRemoved(selected.id);
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const updateLocalProfile = async (payload: {
    remark?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    nextRenewalOn?: string;
    proxy?: string;
    session?: unknown;
  }) => {
    if (!selected) return;
    setLocalError('');
    try {
      await actionBusy.run('edit-parent-profile', async () => {
        const updated = await apiClient.updateAccountLocalProfile(selected.id, payload as {
          remark?: string;
          groupName?: string;
          limitType?: AccountLimitType;
          nextRenewalOn?: string;
          proxy?: string;
          session?: unknown;
        });
        onAccountChanged(updated);
        const next = setSearchValue(clearModalState(searchParams), 'group', parentGroupName(updated));
        navigate({ pathname: `/parents/${updated.id}`, search: toSearch(next) }, { replace: true });
        setBillingRisk(null);
        setLocalError('');
      });
    } catch (error) {
      reportLocalError(error);
      throw error;
    }
  };

  const submitInvite = async (values: InviteValues, confirmBillingRisk = false) => {
    if (!selected) return;
    const email = values.email.trim();
    const seatSlotProfile = seatSlotProfileFromInviteValues(values);
    actionBusy.start('invite-member');
    setLocalError('');
    try {
      const updated = await apiClient.invite(selected.id, email, values.seat, seatSlotProfile, confirmBillingRisk);
      onAccountChanged(updated);
      inviteForm.resetFields();
      closeModal();
    } catch (error) {
      if (isBillingRiskError(error)) {
        openBillingRisk({ kind: 'invite', email, seat: values.seat, seatSlotProfile });
      } else {
        reportLocalError(error);
      }
    } finally {
      actionBusy.finish('invite-member');
    }
  };

  const confirmBillingRisk = async () => {
    if (!selected || !billingRisk) {
      closeModal();
      return;
    }
    actionBusy.start('billing-risk');
    setLocalError('');
    try {
      const updated =
        billingRisk.kind === 'invite'
          ? await apiClient.invite(
              selected.id,
              billingRisk.email,
              billingRisk.seat,
              billingRisk.seatSlotProfile,
              true
            )
          : await apiClient.setMemberSeat(selected.id, billingRisk.userId, billingRisk.seat, true);
      onAccountChanged(updated);
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      actionBusy.finish('billing-risk');
    }
  };

  const changeGroup = (group: string) => {
    const firstInGroup =
      group === ALL_PARENT_GROUP
        ? filteredAccounts[0]
        : filteredAccounts.find((account) => parentGroupName(account) === group);
    const next = setSearchValue(searchParams, 'group', group);
    next.set('tab', searchState.tab);
    navigate({ pathname: firstInGroup ? `/parents/${firstInGroup.id}` : '/parents', search: toSearch(next) });
  };

  const selectAccount = (account: AccountView) => {
    const next = setSearchValue(
      searchParams,
      'group',
      activeGroup === ALL_PARENT_GROUP ? ALL_PARENT_GROUP : parentGroupName(account)
    );
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

      <LocalProfileModal
        open={searchState.modal === 'import-parent'}
        mode="parent"
        title="录入母号 Session"
        description="保存后先创建本地记录。粘贴 chatgpt.com session JSON，建议包含 sessionToken。ChatGPT 状态在母号详情中手动同步。"
        submitLabel="保存母号"
        requireSession
        initialValues={{
          remark: '',
          groupName: activeGroup === ALL_PARENT_GROUP ? '默认分组' : activeGroup,
          limitType: 'unknown',
          nextRenewalOn: '',
          proxy: ''
        }}
        confirmLoading={actionBusy.isBusy('import-parent')}
        onCancel={closeModal}
        onSubmit={importParent}
      />

      <LocalProfileModal
        open={searchState.modal === 'edit-parent-profile' && Boolean(selected)}
        mode="parent"
        title="编辑母号本地资料"
        description="只更新本系统内的备注、分组、限额类型、下次续费时间和 session，不修改远端 Team 名称。"
        initialValues={{
          remark: selected?.remark ?? '',
          groupName: selected?.groupName || '默认分组',
          limitType: selected?.limitType ?? 'unknown',
          nextRenewalOn: selected?.nextRenewalOn ?? '',
          proxy: selected?.proxy ?? '',
          session: selected?.session
        }}
        confirmLoading={actionBusy.isBusy('edit-parent-profile')}
        onCancel={closeModal}
        onSubmit={updateLocalProfile}
      />

      <Modal
        open={searchState.modal === 'delete-parent' && Boolean(selected)}
        title="删除母号"
        okText="删除母号"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: actionBusy.isBusy('delete-parent') }}
        onOk={() => void deleteParent()}
        onCancel={closeModal}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <span>确认删除 {selected?.email} 的本地记录？远端 Team 不会被删除。</span>
          <ModalErrorAlert message={searchState.modal === 'delete-parent' ? localError : ''} />
        </Space>
      </Modal>

      <Modal
        open={searchState.modal === 'invite-member' && Boolean(selected)}
        title="邀请成员"
        okText="发送邀请"
        cancelText="取消"
        confirmLoading={actionBusy.isBusy('invite-member')}
        onOk={() => inviteForm.submit()}
        onCancel={closeModal}
        destroyOnClose
      >
        <Form<InviteValues>
          form={inviteForm}
          layout="vertical"
          disabled={actionBusy.isBusy('invite-member')}
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
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.seat !== current.seat}>
            {({ getFieldValue }) => getFieldValue('seat') === 'default' ? <SeatSlotProfileFields /> : null}
          </Form.Item>
        </Form>
        <ModalErrorAlert message={searchState.modal === 'invite-member' ? localError : ''} />
      </Modal>

      <BillingRiskModal
        open={searchState.modal === 'billing-risk'}
        confirmLoading={actionBusy.isBusy('billing-risk')}
        error={searchState.modal === 'billing-risk' ? localError : ''}
        onCancel={closeModal}
        onConfirm={() => void confirmBillingRisk()}
      />

      <Button className="floating-primary-action" type="primary" onClick={() => openModal('import-parent')}>
        录入母号
      </Button>
    </div>
  );
}
