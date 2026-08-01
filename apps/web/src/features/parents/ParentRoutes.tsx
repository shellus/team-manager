import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccountLimitType,
  AccountLocalProfileView,
  AccountManagerProfileView,
  AccountManagerRuntimeStatus,
  AccountSeatSlotProfileInput,
  AccountSummaryView,
  AccountView,
  OpenCodexSpaceRequest,
  OpenPro5xRequest,
  OpenTeamSubscriptionRequest,
  ParentAccountManagerStatus,
  ParentRegistrationTaskView,
  RegistrationFormPreference,
  SeatType
} from '@team-manager/shared';
import { Alert, Form, Input, Modal, Select, Space } from 'antd';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import {
  clearModalState,
  normalizeRegistrationRouteSearch,
  parseParentSearchState,
  resolveParentTabForWorkspace,
  setModalState,
  setSearchValue,
  type ParentModal,
  type ParentTab
} from '../../app/routeState.js';
import { matchesKeywordQuery } from '../../components/keywordSearch.js';
import { LocalProfileModal } from '../../components/LocalProfileModal.js';
import { ModalErrorAlert } from '../../components/ModalErrorAlert.js';
import { OpenCodexSpaceModal } from '../../components/OpenCodexSpaceModal.js';
import { OpenTeamSubscriptionModal } from '../../components/OpenTeamSubscriptionModal.js';
import { OpenPro5xModal } from '../../components/OpenPro5xModal.js';
import { compareRecordSortName } from '../../components/recordSort.js';
import { PendingRegistrationAccountManagerDetail } from '../../components/PendingRegistrationAccountManagerDetail.js';
import { RegistrationStartModal } from '../../components/RegistrationStartModal.js';
import { compareRunningProfileFirst } from '../../components/AccountProfileListStatus.js';
import { parentRegistrationStageNeedsPolling } from '../../components/registrationPolling.js';
import {
  readLocalGroupPreference,
  rememberLocalGroupPreference,
  resolvePreferredLocalGroup
} from '../../components/recordGroups.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { useTaskFormPreferences } from '../../components/useTaskFormPreferences.js';
import { SEAT_LABEL } from '../../labels.js';
import { defaultSeatSlotExpiresOn, SeatSlotProfileFields } from './SeatSlotProfileModal.js';
import { ParentDetail } from './ParentDetail.js';
import { ParentList } from './ParentList.js';
import {
  PARENT_QUICK_FILTER_PARAM,
  parentMatchesQuickFilters,
  parseParentQuickFilters,
  readParentQuickFilterPreference,
  rememberParentQuickFilterPreference,
  serializeParentQuickFilters,
  type ParentQuickFilter
} from './parentQuickFilters.js';
import { canManageParentWorkspace } from './parentWorkspaceCapability.js';
import {
  ALL_PARENT_GROUP,
  countParentGroups,
  DEFAULT_PARENT_GROUP,
  filterParentsByGroup,
  parentGroupName,
  parentRegistrationTaskGroupName
} from './parentGroups.js';

interface InviteValues {
  email: string;
  seat: SeatType;
  remark?: string;
  expiresOn: string;
  expireRemove: boolean;
  expireReminder: boolean;
}

const PARENT_GROUP_PREFERENCE_KEY = 'team-manager:parents:last-group';

function toSearch(params: URLSearchParams): string {
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function buildParentDeleteLocation(
  params: URLSearchParams,
  account: Pick<AccountSummaryView, 'id' | 'groupName'>,
  activeGroup: string,
  tab: ParentTab
) {
  let next = setSearchValue(
    params,
    'group',
    activeGroup === ALL_PARENT_GROUP ? ALL_PARENT_GROUP : parentGroupName(account)
  );
  next = setSearchValue(next, 'tab', tab);
  next = setModalState(next, 'delete-parent', account.id);
  return { pathname: `/parents/${account.id}`, search: toSearch(next) };
}

export function buildParentAfterDeleteLocation(
  params: URLSearchParams,
  accounts: Pick<AccountSummaryView, 'id'>[],
  deletedId: string
) {
  const nextAccount = accounts.find((account) => account.id !== deletedId);
  return {
    pathname: nextAccount ? `/parents/${nextAccount.id}` : '/parents',
    search: toSearch(clearModalState(params))
  };
}

export function clearStaleParentDeleteState(
  params: URLSearchParams,
  modal: ParentModal | undefined,
  target: string,
  selectedId: string | undefined
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (modal === 'delete-parent' && target && target !== selectedId) {
    next.delete('modal');
    next.delete('target');
  }
  return next;
}

export function parentAccountManagerStatusNeedsPolling(status: ParentAccountManagerStatus): boolean {
  const operationNeedsPolling = (
    operation: ParentAccountManagerStatus['codexOperation'],
    reflectedInAccountStatus: boolean
  ) => Boolean(operation && (
    operation.status === 'queued'
    || operation.status === 'running'
    || operation.status === 'waiting_for_otp'
    || operation.status === 'waiting_manual'
    || (operation.status === 'succeeded' && !reflectedInAccountStatus)
  ));
  return operationNeedsPolling(status.codexOperation, status.hasCodexSpace)
    || operationNeedsPolling(status.teamOperation, status.hasTeamSubscription)
    || operationNeedsPolling(status.pro5xOperation, status.hasPro5x === true)
    || operationNeedsPolling(status.enrollmentOperation, status.managed);
}

function accountMatchesQuery(account: AccountSummaryView, query: string): boolean {
  return matchesKeywordQuery([account.searchText], query);
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

export function seatSlotProfileFromInviteValues(values: InviteValues): AccountSeatSlotProfileInput {
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
  onAccountSummaryChanged,
  onAccountRemoved,
  onRefreshAccount,
  onError
}: {
  accounts: AccountSummaryView[];
  loading: boolean;
  globalError: string;
  syncingIds: Set<string>;
  onAccountChanged: (account: AccountView) => void;
  onAccountSummaryChanged: (account: AccountSummaryView) => void;
  onAccountRemoved: (id: string) => void;
  onRefreshAccount: (account: AccountSummaryView) => Promise<AccountView | undefined>;
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { accountId, registrationOperationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = parseParentSearchState(searchParams);
  const [inviteForm] = Form.useForm<InviteValues>();
  const [localError, setLocalError] = useState('');
  const [accountDetails, setAccountDetails] = useState<Record<string, AccountView>>({});
  const [detailLoadingId, setDetailLoadingId] = useState('');
  const [localProfile, setLocalProfile] = useState<AccountLocalProfileView | null>(null);
  const [localProfileLoading, setLocalProfileLoading] = useState(false);
  const [registrationTasks, setRegistrationTasks] = useState<ParentRegistrationTaskView[]>([]);
  const [registrationTasksLoaded, setRegistrationTasksLoaded] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<AccountManagerRuntimeStatus | null>(null);
  const [accountManagerStatuses, setAccountManagerStatuses] = useState<Record<string, ParentAccountManagerStatus>>({});
  const [accountProfileStatuses, setAccountProfileStatuses] = useState<Record<string, AccountManagerProfileView>>({});
  const [accountManagerLoading, setAccountManagerLoading] = useState(false);
  const [accountManagerStatusError, setAccountManagerStatusError] = useState('');
  const [maintainedAccountIds, setMaintainedAccountIds] = useState<Set<string>>(new Set());
  const actionBusy = useActionBusy();
  const { preferences: taskFormPreferences, rememberPreference } = useTaskFormPreferences();
  const searchQuery = searchParams.get('q') ?? '';
  const quickFilters = useMemo(
    () => searchParams.has(PARENT_QUICK_FILTER_PARAM)
      ? parseParentQuickFilters(searchParams.get(PARENT_QUICK_FILTER_PARAM))
      : readParentQuickFilterPreference(),
    [searchParams]
  );
  const sortedAccounts = useMemo(
    () => [...accounts].sort((left, right) => compareRunningProfileFirst(
      left,
      right,
      accountProfileStatuses,
      compareRecordSortName
    )),
    [accountProfileStatuses, accounts]
  );
  const filteredAccounts = useMemo(
    () => sortedAccounts.filter((account) => (
      accountMatchesQuery(account, searchQuery)
      && parentMatchesQuickFilters(
        account,
        accountManagerStatuses[account.id],
        maintainedAccountIds,
        quickFilters
      )
    )),
    [accountManagerStatuses, maintainedAccountIds, quickFilters, searchQuery, sortedAccounts]
  );
  const accountIdsKey = accounts.map((account) => account.id).sort().join('|');

  useEffect(() => {
    let cancelled = false;
    const loadMaintainedAccounts = async () => {
      try {
        const dashboard = await apiClient.getTeamOrderDashboard();
        if (!cancelled) {
          setMaintainedAccountIds(new Set(
            dashboard.items
              .filter((item) => item.maintenance.status === 'active')
              .map((item) => item.account.id)
          ));
        }
      } catch {
        // 母号主工作台不因辅助维护标签加载失败而阻塞。
      }
    };
    void loadMaintainedAccounts();
    const timer = window.setInterval(() => void loadMaintainedAccounts(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountIdsKey]);

  const groups = useMemo(() => countParentGroups([
    ...sortedAccounts,
    ...registrationTasks.map((task) => ({ groupName: parentRegistrationTaskGroupName(task) }))
  ]), [registrationTasks, sortedAccounts]);
  const activeGroup = resolvePreferredLocalGroup(
    searchParams.has('group') ? searchState.group : undefined,
    readLocalGroupPreference(PARENT_GROUP_PREFERENCE_KEY),
    groups
  );
  const visibleAccounts = useMemo(
    () => filterParentsByGroup(filteredAccounts, activeGroup),
    [filteredAccounts, activeGroup]
  );
  const selectedRegistrationTask = registrationTasks.find(
    (task) => task.registration.id === registrationOperationId
  ) ?? null;
  const selectedSummary = registrationOperationId
    ? null
    : visibleAccounts.find((account) => account.id === accountId) ?? visibleAccounts[0] ?? null;
  const selected = selectedSummary ? accountDetails[selectedSummary.id] ?? null : null;
  const accountManagerStatus = selectedSummary ? accountManagerStatuses[selectedSummary.id] ?? null : null;

  const mergeAccountView = useCallback((updated: AccountView) => {
    setAccountDetails((current) => ({ ...current, [updated.id]: updated }));
    onAccountChanged(updated);
  }, [onAccountChanged]);

  useEffect(() => {
    if (!selectedSummary || selected) return;
    const id = selectedSummary.id;
    let cancelled = false;
    setDetailLoadingId(id);
    void apiClient.getAccount(id)
      .then((detail) => {
        if (!cancelled) setAccountDetails((current) => ({ ...current, [id]: detail }));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLocalError((error as Error).message);
          onError(error);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoadingId((current) => current === id ? '' : current);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, selected, selectedSummary]);

  useEffect(() => {
    if (searchState.modal !== 'edit-parent-profile' || !selectedSummary) {
      setLocalProfile(null);
      setLocalProfileLoading(false);
      return;
    }
    const id = selectedSummary.id;
    let cancelled = false;
    setLocalProfile(null);
    setLocalProfileLoading(true);
    void apiClient.getAccountLocalProfile(id)
      .then((profile) => {
        if (!cancelled) setLocalProfile(profile);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLocalError((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLocalProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchState.modal, selectedSummary]);

  const loadRegistrationTasks = useCallback(async () => {
    try {
      const tasks = await apiClient.listParentRegistrationTasks();
      for (const task of tasks) {
        if (task.parent) onAccountSummaryChanged(task.parent);
      }
      setRegistrationTasks(tasks.filter((task) => task.stage !== 'completed'));
      const completedSelection = registrationOperationId
        ? tasks.find((task) => task.registration.id === registrationOperationId && task.parent)
        : undefined;
      if (completedSelection?.parent) {
        const next = clearModalState(searchParams);
        next.set('tab', 'account-manager');
        navigate({
          pathname: `/parents/${completedSelection.parent.id}`,
          search: toSearch(next)
        }, { replace: true });
      }
    } catch (error) {
      setLocalError((error as Error).message);
      onError(error);
    } finally {
      setRegistrationTasksLoaded(true);
    }
  }, [navigate, onAccountSummaryChanged, onError, registrationOperationId, searchParams]);

  const loadRuntimeStatus = useCallback(async () => {
    try {
      setRuntimeStatus(await apiClient.getParentRegistrationRuntimeStatus());
    } catch (error) {
      setRuntimeStatus({ configured: false, reachable: false, error: (error as Error).message });
    }
  }, []);

  const loadAccountManagerStatuses = useCallback(async (background = false) => {
    if (!background) setAccountManagerLoading(true);
    try {
      const statuses = await apiClient.getParentAccountManagerStatuses();
      for (const status of Object.values(statuses)) {
        for (const imported of status.importedAccounts ?? []) {
          onAccountSummaryChanged(imported);
          setAccountDetails((current) => {
            if (!current[imported.id]) return current;
            const next = { ...current };
            delete next[imported.id];
            return next;
          });
        }
      }
      setAccountManagerStatuses(statuses);
      setAccountManagerStatusError('');
    } catch (error) {
      setAccountManagerStatusError((error as Error).message);
    } finally {
      if (!background) setAccountManagerLoading(false);
    }
  }, [onAccountSummaryChanged]);

  const updateAccountProfileStatus = useCallback((id: string, profile: AccountManagerProfileView) => {
    setAccountProfileStatuses((current) => ({ ...current, [id]: profile }));
  }, []);

  const updateAccountManagerStatus = useCallback((id: string, status: ParentAccountManagerStatus) => {
    for (const imported of status.importedAccounts ?? []) {
      onAccountSummaryChanged(imported);
      setAccountDetails((current) => {
        if (!current[imported.id]) return current;
        const next = { ...current };
        delete next[imported.id];
        return next;
      });
    }
    setAccountManagerStatuses((current) => ({ ...current, [id]: status }));
  }, [onAccountSummaryChanged]);

  useEffect(() => {
    rememberParentQuickFilterPreference(quickFilters);
  }, [quickFilters]);

  useEffect(() => {
    if (registrationOperationId) {
      if (!registrationTasksLoaded) return;
      const nextParams = normalizeRegistrationRouteSearch(searchParams, Boolean(selectedRegistrationTask));
      const nextPath = selectedRegistrationTask
        ? `/parents/registrations/${registrationOperationId}`
        : '/parents';
      if (location.pathname !== nextPath || nextParams.toString() !== searchParams.toString()) {
        navigate({ pathname: nextPath, search: toSearch(nextParams) }, { replace: true });
      }
      return;
    }
    if (loading || accounts.length === 0) return;
    rememberLocalGroupPreference(PARENT_GROUP_PREFERENCE_KEY, activeGroup);
    const nextParams = clearStaleParentDeleteState(
      searchParams,
      searchState.modal,
      searchState.target,
      selectedSummary?.id
    );
    let changed = nextParams.toString() !== searchParams.toString();
    if (searchState.group !== activeGroup) {
      if (activeGroup === ALL_PARENT_GROUP) nextParams.delete('group');
      else nextParams.set('group', activeGroup);
      changed = true;
    }
    const targetTab = selectedSummary
      ? resolveParentTabForWorkspace(
          canManageParentWorkspace(selectedSummary, accountManagerStatuses[selectedSummary.id]),
          searchState.tab,
          (selectedSummary.memberAndInviteCount ?? 0) > 0 || selectedSummary.seatSlotCount > 0
        )
      : searchState.tab;
    if (searchParams.get('tab') !== targetTab) {
      nextParams.set('tab', targetTab);
      changed = true;
    }
    const serializedQuickFilters = serializeParentQuickFilters(quickFilters);
    if (serializedQuickFilters) {
      if (searchParams.get(PARENT_QUICK_FILTER_PARAM) !== serializedQuickFilters) {
        nextParams.set(PARENT_QUICK_FILTER_PARAM, serializedQuickFilters);
        changed = true;
      }
    } else if (searchParams.has(PARENT_QUICK_FILTER_PARAM)) {
      nextParams.delete(PARENT_QUICK_FILTER_PARAM);
      changed = true;
    }
    const nextPath = selectedSummary ? `/parents/${selectedSummary.id}` : '/parents';
    if (location.pathname !== nextPath || changed) {
      navigate({ pathname: nextPath, search: toSearch(nextParams) }, { replace: true });
    }
  }, [
    accountManagerStatuses,
    accounts.length,
    activeGroup,
    loading,
    location.pathname,
    navigate,
    quickFilters,
    registrationOperationId,
    registrationTasksLoaded,
    searchParams,
    searchState.group,
    searchState.modal,
    searchState.tab,
    searchState.target,
    selectedRegistrationTask,
    selectedSummary
  ]);

  useEffect(() => {
    if (searchState.modal === 'invite-member') {
      inviteForm.setFieldsValue(defaultInviteValues(selectedSummary?.defaultSeat));
    }
  }, [inviteForm, searchState.modal, selectedSummary?.defaultSeat]);

  useEffect(() => {
    void loadRegistrationTasks();
    void loadRuntimeStatus();
  }, [loadRegistrationTasks, loadRuntimeStatus]);

  const hasActiveRegistrationTask = registrationTasks.some((task) =>
    parentRegistrationStageNeedsPolling(task.stage)
  );
  const hasActiveAccountOperation = Object.values(accountManagerStatuses).some(
    parentAccountManagerStatusNeedsPolling
  );
  const hasManagedParent = accounts.some((account) => Boolean(account.managedAccountEmail));
  const hasUnavailableAccountManagerStatus = Object.values(accountManagerStatuses).some((status) =>
    status.configured && !status.reachable
  );
  const shouldPollAccountManager = hasActiveAccountOperation
    || hasUnavailableAccountManagerStatus
    || (hasManagedParent && Boolean(accountManagerStatusError));

  useEffect(() => {
    if (!hasActiveRegistrationTask && !shouldPollAccountManager) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await Promise.all([
        hasActiveRegistrationTask ? loadRegistrationTasks() : Promise.resolve(),
        shouldPollAccountManager ? loadAccountManagerStatuses(true) : Promise.resolve()
      ]).catch(() => undefined);
      if (!cancelled) timer = window.setTimeout(poll, hasActiveAccountOperation ? 1500 : 3000);
    };
    timer = window.setTimeout(poll, hasActiveAccountOperation ? 700 : 2000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasActiveAccountOperation, hasActiveRegistrationTask, loadAccountManagerStatuses, loadRegistrationTasks, shouldPollAccountManager]);

  const closeModal = () => {
    const next = clearModalState(searchParams);
    setSearchParams(next);
    setLocalError('');
  };

  const openModal = (modal: ParentModal, target = '') => {
    setLocalError('');
    setSearchParams(setModalState(searchParams, modal, target));
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
        mergeAccountView(account);
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

  const registerParent = async (values: RegistrationFormPreference) => {
    setLocalError('');
    rememberPreference('parentRegistration', values);
    try {
      await actionBusy.run('register-parent', async () => {
        const operation = await apiClient.registerParentAccount(values);
        closeModal();
        await loadRegistrationTasks();
        await loadRuntimeStatus();
        const next = clearModalState(searchParams);
        next.set('tab', 'account-manager');
        navigate({
          pathname: `/parents/registrations/${operation.id}`,
          search: toSearch(next)
        });
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const retryParentRegistration = async (task: ParentRegistrationTaskView) => {
    const key = `retry-parent-registration-${task.registration.id}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        if (task.stage !== 'import_failed') {
          await apiClient.retryParentRegistration(task.registration.id);
        }
        await loadRegistrationTasks();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const cancelParentRegistration = async (task: ParentRegistrationTaskView) => {
    const key = `cancel-parent-registration-${task.registration.id}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.cancelParentRegistration(task.registration.id);
        await loadRegistrationTasks();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const openCodexModal = (target: string) => {
    const next = setModalState(searchParams, 'open-codex-space', target);
    setLocalError('');
    setSearchParams(next);
  };

  const submitCodexSpace = async (payload: OpenCodexSpaceRequest) => {
    const target = searchState.target;
    if (!target) return;
    setLocalError('');
    try {
      await actionBusy.run('open-codex-space', async () => {
        await apiClient.openParentCodexSpace(target, payload);
        await loadAccountManagerStatuses();
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const submitTeamSubscription = async (payload: OpenTeamSubscriptionRequest) => {
    const target = searchState.target;
    if (!target) return;
    setLocalError('');
    try {
      await actionBusy.run('open-team-subscription', async () => {
        await apiClient.openParentTeamSubscription(target, payload);
        await loadAccountManagerStatuses();
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const submitPro5x = async (payload: OpenPro5xRequest) => {
    const target = searchState.target;
    if (!target) return;
    setLocalError('');
    try {
      await actionBusy.run('open-pro-5x', async () => {
        const operation = accountManagerStatuses[target]?.pro5xOperation;
        if (operation?.phase === 'pro5x_payment_card_required') {
          await apiClient.provideParentPro5xPaymentCard(target, operation.id, payload);
        } else {
          rememberPreference('pro5x', {
            usePromoCode: payload.usePromoCode !== false,
            promoCode: payload.promoCode?.trim() ?? ''
          });
          await apiClient.openParentPro5x(target, payload);
        }
        await loadAccountManagerStatuses();
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const terminateOperation = async (
    account: AccountSummaryView,
    operation: ParentAccountManagerStatus['codexOperation']
  ) => {
    if (!operation) return;
    const key = `terminate-operation-${operation.id}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.terminateParentOperation(account.id, operation.id);
        await loadAccountManagerStatuses();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const retryPro5x = async (accountId: string, operationId: string) => {
    const key = `retry-pro5x-${operationId}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.retryParentOperationCurrentStep(accountId, operationId);
        await loadAccountManagerStatuses();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const rotatePro5x = async (accountId: string, operationId: string) => {
    const key = `rotate-pro5x-${operationId}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.rotateParentOperationIp(accountId, operationId);
        await loadAccountManagerStatuses();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const terminatePro5x = async (accountId: string, operationId: string) => {
    const key = `terminate-pro5x-${operationId}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.terminateParentOperation(accountId, operationId);
        await loadAccountManagerStatuses();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const dismissOperation = async (
    account: AccountSummaryView,
    operation: ParentAccountManagerStatus['codexOperation']
  ) => {
    if (!operation) return;
    const key = `dismiss-operation-${operation.id}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.dismissParentOperation(account.id, operation.id);
        await loadAccountManagerStatuses();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const deleteParent = async () => {
    if (!selectedSummary) return;
    const deletedId = selectedSummary.id;
    const afterDeleteLocation = buildParentAfterDeleteLocation(searchParams, visibleAccounts, deletedId);
    setLocalError('');
    try {
      await actionBusy.run('delete-parent', async () => {
        const removed = await apiClient.removeAccount(deletedId);
        if (!removed) throw new Error('删除母号失败：本地记录不存在');
        onAccountRemoved(deletedId);
        setAccountDetails((current) => {
          const next = { ...current };
          delete next[deletedId];
          return next;
        });
        setAccountManagerStatuses((current) => {
          const next = { ...current };
          delete next[deletedId];
          return next;
        });
        setMaintainedAccountIds((current) => {
          if (!current.has(deletedId)) return current;
          const next = new Set(current);
          next.delete(deletedId);
          return next;
        });
        navigate(afterDeleteLocation, { replace: true });
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const updateLocalProfile = async (payload: {
    remark?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    isBanned?: boolean;
    nextRenewalOn?: string;
    proxy?: string;
    session?: unknown;
  }) => {
    if (!selectedSummary) return;
    setLocalError('');
    try {
      await actionBusy.run('edit-parent-profile', async () => {
        const updated = await apiClient.updateAccountLocalProfile(selectedSummary.id, payload as {
          remark?: string;
          groupName?: string;
          limitType?: AccountLimitType;
          isBanned?: boolean;
          nextRenewalOn?: string;
          proxy?: string;
          session?: unknown;
        });
        mergeAccountView(updated);
        const next = setSearchValue(clearModalState(searchParams), 'group', parentGroupName(updated));
        navigate({ pathname: `/parents/${updated.id}`, search: toSearch(next) }, { replace: true });
        setLocalError('');
      });
    } catch (error) {
      reportLocalError(error);
      throw error;
    }
  };

  const submitInvite = async (values: InviteValues) => {
    if (!selectedSummary) return;
    const email = values.email.trim();
    const seatSlotProfile = seatSlotProfileFromInviteValues(values);
    actionBusy.start('invite-member');
    setLocalError('');
    try {
      const updated = await apiClient.invite(selectedSummary.id, email, values.seat, seatSlotProfile);
      mergeAccountView(updated);
      inviteForm.resetFields();
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      actionBusy.finish('invite-member');
    }
  };

  const changeGroup = (group: string) => {
    rememberLocalGroupPreference(PARENT_GROUP_PREFERENCE_KEY, group);
    const firstInGroup =
      group === ALL_PARENT_GROUP
        ? filteredAccounts[0]
        : filteredAccounts.find((account) => parentGroupName(account) === group);
    const next = setSearchValue(searchParams, 'group', group);
    next.set('tab', searchState.tab);
    navigate({ pathname: firstInGroup ? `/parents/${firstInGroup.id}` : '/parents', search: toSearch(next) });
  };

  const selectAccount = (account: AccountSummaryView) => {
    const next = setSearchValue(
      searchParams,
      'group',
      activeGroup === ALL_PARENT_GROUP ? ALL_PARENT_GROUP : parentGroupName(account)
    );
    navigate({ pathname: `/parents/${account.id}`, search: toSearch(next) });
  };

  const selectRegistrationTask = (task: ParentRegistrationTaskView) => {
    const next = clearModalState(searchParams);
    next.set('tab', 'account-manager');
    navigate({
      pathname: `/parents/registrations/${task.registration.id}`,
      search: toSearch(next)
    });
  };

  const openDeleteParent = (account: AccountSummaryView) => {
    setLocalError('');
    navigate(buildParentDeleteLocation(searchParams, account, activeGroup, searchState.tab));
  };

  const changeSearchQuery = (query: string) => {
    const next = setSearchValue(searchParams, 'q', query);
    next.set('tab', searchState.tab);
    setSearchParams(next);
  };

  const changeQuickFilters = (filters: ParentQuickFilter[]) => {
    rememberParentQuickFilterPreference(filters);
    const next = setSearchValue(
      searchParams,
      PARENT_QUICK_FILTER_PARAM,
      serializeParentQuickFilters(filters)
    );
    next.set('tab', searchState.tab);
    setSearchParams(next);
  };

  const changeTab = (tab: ParentTab) => {
    setSearchParams(setSearchValue(searchParams, 'tab', tab));
  };

  const refreshAccount = async (account: AccountSummaryView) => {
    const updated = await onRefreshAccount(account);
    if (!updated) return;
    setAccountDetails((current) => ({ ...current, [updated.id]: updated }));
    await Promise.all([
      loadAccountManagerStatuses(),
      apiClient.getParentAccountProfile(updated.id)
        .then((profile) => updateAccountProfileStatus(updated.id, profile))
        .catch(() => undefined)
    ]);
  };

  return (
    <div className="workbench">
      <ParentList
        groups={groups}
        activeGroup={activeGroup}
        accounts={visibleAccounts}
        accountManagerStatuses={accountManagerStatuses}
        accountProfileStatuses={accountProfileStatuses}
        registrationTasks={registrationTasks}
        maintainedAccountIds={maintainedAccountIds}
        searchQuery={searchQuery}
        quickFilters={quickFilters}
        selectedId={selectedSummary?.id ?? ''}
        selectedRegistrationId={registrationOperationId}
        syncingIds={syncingIds}
        runtimeStatus={runtimeStatus}
        isBusy={actionBusy.isBusy}
        onGroupChange={changeGroup}
        onSearchChange={changeSearchQuery}
        onQuickFiltersChange={changeQuickFilters}
        onOpenRegister={() => openModal('register-parent')}
        onOpenImport={() => openModal('import-parent')}
        onRetryRegistration={(task) => void retryParentRegistration(task)}
        onCancelRegistration={(task) => void cancelParentRegistration(task)}
        onTerminateOperation={(account, operation) => void terminateOperation(account, operation)}
        onDismissOperation={(account, operation) => void dismissOperation(account, operation)}
        onSelect={selectAccount}
        onSelectRegistration={selectRegistrationTask}
        onRefreshAccount={(account) => void refreshAccount(account)}
        onOpenDelete={openDeleteParent}
      />

      <Space direction="vertical" size={12} className="content-pane">
        {(globalError || localError || accountManagerStatusError) && (
          <Alert type="error" showIcon message={localError || globalError || accountManagerStatusError} />
        )}
        {selectedRegistrationTask ? (
          <PendingRegistrationAccountManagerDetail
            recordLabel="母号"
            operationId={selectedRegistrationTask.registration.id}
            email={selectedRegistrationTask.email}
            message={selectedRegistrationTask.registration.message || selectedRegistrationTask.registration.phase}
            progress={selectedRegistrationTask.registration.progress}
            status={selectedRegistrationTask.registration.status}
            phase={selectedRegistrationTask.registration.phase}
            cancelLoading={actionBusy.isBusy(
              `cancel-parent-registration-${selectedRegistrationTask.registration.id}`
            )}
            onCancel={() => void cancelParentRegistration(selectedRegistrationTask)}
            failed={selectedRegistrationTask.stage === 'registration_failed'
              || selectedRegistrationTask.stage === 'import_failed'}
            waitingManual={selectedRegistrationTask.stage === 'waiting_manual'}
          />
        ) : (
          <ParentDetail
            account={selected}
            activeTab={searchState.tab}
            loading={Boolean(selectedSummary) && !selected && detailLoadingId === selectedSummary?.id}
            syncing={selectedSummary ? syncingIds.has(selectedSummary.id) : false}
            accountManagerStatus={accountManagerStatus}
            accountManagerLoading={accountManagerLoading}
            busyState={actionBusy.busyState}
            onTabChange={changeTab}
            onSync={() => selectedSummary && void refreshAccount(selectedSummary)}
            onOpenInvite={() => openModal('invite-member', selectedSummary?.id ?? '')}
            onOpenCodexSpace={() => selectedSummary && openCodexModal(selectedSummary.id)}
            onOpenTeamSubscription={() => selectedSummary && openModal('open-team-subscription', selectedSummary.id)}
            onOpenPro5x={() => selectedSummary && openModal('open-pro-5x', selectedSummary.id)}
            onRetryPro5x={(operationId) => {
              if (selectedSummary) void retryPro5x(selectedSummary.id, operationId);
            }}
            onRotatePro5x={(operationId) => {
              if (selectedSummary) void rotatePro5x(selectedSummary.id, operationId);
            }}
            onTerminatePro5x={(operationId) => {
              if (selectedSummary) void terminatePro5x(selectedSummary.id, operationId);
            }}
            onOpenLocalProfile={() => selectedSummary && openModal('edit-parent-profile', selectedSummary.id)}
            onAccountChanged={mergeAccountView}
            onAccountManagerStatusChanged={(status) => {
              if (selectedSummary) updateAccountManagerStatus(selectedSummary.id, status);
            }}
            onAccountProfileChanged={(profile) => {
              if (selectedSummary) updateAccountProfileStatus(selectedSummary.id, profile);
            }}
          />
        )}
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
          groupName: activeGroup === ALL_PARENT_GROUP ? DEFAULT_PARENT_GROUP : activeGroup,
          limitType: 'unknown',
          isBanned: false,
          nextRenewalOn: '',
          proxy: ''
        }}
        confirmLoading={actionBusy.isBusy('import-parent')}
        onCancel={closeModal}
        onSubmit={importParent}
      />

      <LocalProfileModal
        open={searchState.modal === 'edit-parent-profile' && Boolean(selectedSummary)}
        mode="parent"
        title="编辑母号本地资料"
        description="只更新本系统内的备注、分组、封号标记、限额类型、下次续费时间、代理地址和 session，不修改远端 Team 名称。"
        initialValues={{
          remark: localProfile?.remark ?? selectedSummary?.remark ?? '',
          groupName: localProfile?.groupName || selectedSummary?.groupName || '默认分组',
          limitType: localProfile?.limitType ?? selectedSummary?.limitType ?? 'unknown',
          isBanned: localProfile?.isBanned ?? selectedSummary?.isBanned ?? false,
          nextRenewalOn: localProfile?.nextRenewalOn ?? selectedSummary?.nextRenewalOn ?? '',
          proxy: localProfile?.proxy ?? '',
          session: localProfile?.session
        }}
        loading={localProfileLoading}
        confirmLoading={actionBusy.isBusy('edit-parent-profile')}
        onCancel={closeModal}
        onSubmit={updateLocalProfile}
      />

      <RegistrationStartModal
        open={searchState.modal === 'register-parent'}
        title="自动注册母号"
        description="系统会通过 GPT Account Manager 注册新 GPT 账号，并按本次设置应用住宅代理国家和母号分组。账号创建并交付 Session 后立即完成；0.52 和双席位可稍后独立开通。"
        initialValues={taskFormPreferences.parentRegistration}
        groupNames={groups.map((group) => group.name)}
        confirmLoading={actionBusy.isBusy('register-parent')}
        error={searchState.modal === 'register-parent' ? localError : ''}
        onCancel={closeModal}
        onSubmit={registerParent}
      />

      <OpenCodexSpaceModal
        open={searchState.modal === 'open-codex-space'}
        description={`为 ${selectedSummary?.remark || selectedSummary?.email || '当前母号'} 对应的 GPT Account Manager 账号开通 0.52 Codex 空间。该动作不影响母号的创建完成状态。`}
        confirmLoading={actionBusy.isBusy('open-codex-space')}
        error={searchState.modal === 'open-codex-space' ? localError : ''}
        onCancel={closeModal}
        onSubmit={submitCodexSpace}
      />

      <OpenTeamSubscriptionModal
        open={searchState.modal === 'open-team-subscription'}
        confirmLoading={actionBusy.isBusy('open-team-subscription')}
        error={searchState.modal === 'open-team-subscription' ? localError : ''}
        workspaceOptions={accountManagerStatus?.teamUpgradeWorkspaces ?? []}
        onCancel={closeModal}
        onSubmit={submitTeamSubscription}
      />

      <OpenPro5xModal
        open={searchState.modal === 'open-pro-5x'}
        confirmLoading={actionBusy.isBusy('open-pro-5x')}
        error={searchState.modal === 'open-pro-5x' ? localError : ''}
        defaultUsePromoCode={taskFormPreferences.pro5x.usePromoCode}
        defaultPromoCode={taskFormPreferences.pro5x.promoCode}
        mode={accountManagerStatus?.pro5xOperation?.phase === 'pro5x_payment_card_required'
          ? 'resume'
          : 'open'}
        onCancel={closeModal}
        onSubmit={submitPro5x}
      />

      <Modal
        open={searchState.modal === 'delete-parent' && searchState.target === selectedSummary?.id}
        title="删除母号"
        okText="删除母号"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: actionBusy.isBusy('delete-parent') }}
        onOk={() => void deleteParent()}
        onCancel={closeModal}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <span>确认删除 {selectedSummary?.email} 的本地记录？远端 Team 不会被删除。</span>
          <ModalErrorAlert message={searchState.modal === 'delete-parent' ? localError : ''} />
        </Space>
      </Modal>

      <Modal
        open={searchState.modal === 'invite-member' && Boolean(selectedSummary)}
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
          initialValues={defaultInviteValues(selectedSummary?.defaultSeat)}
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
          <SeatSlotProfileFields />
        </Form>
        <ModalErrorAlert message={searchState.modal === 'invite-member' ? localError : ''} />
      </Modal>

    </div>
  );
}
