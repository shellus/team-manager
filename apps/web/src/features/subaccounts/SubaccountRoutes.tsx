import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  subaccountSummaryFromView,
  type AccountSummaryView,
  type CodexQuotaSnapshot,
  type OpenPro5xRequest,
  type SeatType,
  type SubaccountAccountManagerStatus,
  type SubaccountAuthLog,
  type SubaccountLocalProfileView,
  type SubaccountRegistrationJobView,
  type AccountManagerRuntimeStatus,
  type AccountManagerProfileView,
  type SubaccountSummaryView,
  type SubaccountView
} from '@team-manager/shared';
import { Alert, Form, Modal, Select, Space } from 'antd';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import {
  clearModalState,
  parseSubaccountSearchState,
  setModalState,
  setSearchValue,
  type SubaccountModal,
  type SubaccountTab
} from '../../app/routeState.js';
import { actionKey } from '../../components/actionBusy.js';
import { registrationStatusNeedsPolling } from '../../components/registrationPolling.js';
import { LocalProfileModal } from '../../components/LocalProfileModal.js';
import { ModalErrorAlert } from '../../components/ModalErrorAlert.js';
import { OpenPro5xModal } from '../../components/OpenPro5xModal.js';
import { PendingRegistrationAccountManagerDetail } from '../../components/PendingRegistrationAccountManagerDetail.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import {
  ALL_LOCAL_GROUP,
  countLocalGroups,
  filterByLocalGroup,
  localGroupName,
  readLocalGroupPreference,
  rememberLocalGroupPreference,
  resolvePreferredLocalGroup
} from '../../components/recordGroups.js';
import { SEAT_LABEL } from '../../labels.js';
import { buildCredentialDownload, downloadTextFile } from './credentialDownload.js';
import { shouldForwardSubaccountErrorToGlobal } from './errorHandling.js';
import { SubaccountDetail } from './SubaccountDetail.js';
import { SubaccountList } from './SubaccountList.js';
import {
  resolveSubaccountDeleteTarget,
  sortSubaccountsForList,
  subaccountAfterRemoval
} from './subaccountListState.js';
import { subaccountMatchesQuery } from './subaccountSearch.js';

interface TeamInviteValues {
  accountId: string;
  seat: SeatType;
}

const SUBACCOUNT_GROUP_PREFERENCE_KEY = 'team-manager:subaccounts:last-group';

function toSearch(params: URLSearchParams): string {
  const value = params.toString();
  return value ? `?${value}` : '';
}

function accountDisplayName(account: AccountSummaryView): string {
  return account.remark || account.workspaceName || account.email;
}

function accountOptionLabel(account: AccountSummaryView): string {
  const primary = accountDisplayName(account);
  return primary === account.email ? primary : `${primary} · ${account.email}`;
}

export function subaccountAccountManagerStatusNeedsPolling(
  status: SubaccountAccountManagerStatus
): boolean {
  const operation = status.pro5xOperation;
  return Boolean(operation && (
    operation.status === 'queued'
    || operation.status === 'running'
    || operation.status === 'waiting_for_otp'
    || operation.status === 'waiting_manual'
    || (operation.status === 'succeeded' && !status.hasPro5x)
  ));
}

export function SubaccountRoutes({
  accounts,
  onError
}: {
  accounts: AccountSummaryView[];
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { subaccountId, registrationJobId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = parseSubaccountSearchState(searchParams);
  const [inviteForm] = Form.useForm<TeamInviteValues>();

  const [subaccounts, setSubaccounts] = useState<SubaccountSummaryView[]>([]);
  const [subaccountDetails, setSubaccountDetails] = useState<Record<string, SubaccountView>>({});
  const [detailLoadingId, setDetailLoadingId] = useState('');
  const [localProfile, setLocalProfile] = useState<SubaccountLocalProfileView | null>(null);
  const [localProfileLoading, setLocalProfileLoading] = useState(false);
  const [registrationJobs, setRegistrationJobs] = useState<SubaccountRegistrationJobView[]>([]);
  const [registrationJobsLoaded, setRegistrationJobsLoaded] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<AccountManagerRuntimeStatus | null>(null);
  const [accountProfileStatuses, setAccountProfileStatuses] = useState<Record<string, AccountManagerProfileView>>({});
  const [accountManagerStatuses, setAccountManagerStatuses] = useState<Record<string, SubaccountAccountManagerStatus>>({});
  const [accountManagerLoadingId, setAccountManagerLoadingId] = useState('');
  const [logs, setLogs] = useState<SubaccountAuthLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const actionBusy = useActionBusy();
  const searchQuery = searchParams.get('q') ?? '';
  const matchingSubaccounts = useMemo(
    () => sortSubaccountsForList(subaccounts, accountProfileStatuses)
      .filter((subaccount) => subaccountMatchesQuery(subaccount, searchQuery)),
    [accountProfileStatuses, searchQuery, subaccounts]
  );
  const groups = useMemo(() => countLocalGroups(subaccounts), [subaccounts]);
  const activeGroup = resolvePreferredLocalGroup(
    searchParams.has('group') ? searchParams.get('group')?.trim() ?? ALL_LOCAL_GROUP : undefined,
    readLocalGroupPreference(SUBACCOUNT_GROUP_PREFERENCE_KEY),
    groups
  );
  const groupedSubaccounts = useMemo(
    () => filterByLocalGroup(matchingSubaccounts, activeGroup),
    [activeGroup, matchingSubaccounts]
  );

  const selectedRegistrationJob = registrationJobs.find((job) => job.id === registrationJobId) ?? null;
  const selectedSummary = registrationJobId
    ? null
    : groupedSubaccounts.find((subaccount) => subaccount.id === subaccountId)
      ?? groupedSubaccounts[0]
      ?? null;
  const selected = selectedSummary ? subaccountDetails[selectedSummary.id] ?? null : null;
  const accountManagerStatus = selectedSummary
    ? accountManagerStatuses[selectedSummary.id] ?? null
    : null;
  const deleteTarget =
    searchState.modal === 'delete-subaccount'
      ? resolveSubaccountDeleteTarget(subaccounts, selectedSummary, searchState.target)
      : null;
  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: accountOptionLabel(account)
      })),
    [accounts]
  );

  const mergeSubaccount = useCallback((updated: SubaccountView) => {
    setSubaccountDetails((current) => ({ ...current, [updated.id]: updated }));
    const summary = subaccountSummaryFromView(updated);
    setSubaccounts((current) => {
      const exists = current.some((item) => item.id === updated.id);
      const next = exists
        ? current.map((item) => (item.id === updated.id ? summary : item))
        : [summary, ...current];
      return sortSubaccountsForList(next);
    });
  }, []);

  const reportLocalError = useCallback(
    (error: unknown) => {
      setLocalError((error as Error).message);
      if (shouldForwardSubaccountErrorToGlobal(error)) onError(error);
    },
    [onError]
  );

  useEffect(() => {
    if (!selectedSummary || selected) return;
    const id = selectedSummary.id;
    let cancelled = false;
    setDetailLoadingId(id);
    void apiClient.getSubaccount(id)
      .then((detail) => {
        if (!cancelled) setSubaccountDetails((current) => ({ ...current, [id]: detail }));
      })
      .catch((error: unknown) => {
        if (!cancelled) reportLocalError(error);
      })
      .finally(() => {
        if (!cancelled) setDetailLoadingId((current) => current === id ? '' : current);
      });
    return () => {
      cancelled = true;
    };
  }, [reportLocalError, selected, selectedSummary]);

  useEffect(() => {
    if (searchState.modal !== 'edit-subaccount-profile' || !selectedSummary) {
      setLocalProfile(null);
      setLocalProfileLoading(false);
      return;
    }
    const id = selectedSummary.id;
    let cancelled = false;
    setLocalProfile(null);
    setLocalProfileLoading(true);
    void apiClient.getSubaccountLocalProfile(id)
      .then((profile) => {
        if (!cancelled) setLocalProfile(profile);
      })
      .catch((error: unknown) => {
        if (!cancelled) reportLocalError(error);
      })
      .finally(() => {
        if (!cancelled) setLocalProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportLocalError, searchState.modal, selectedSummary]);

  const loadSubaccounts = useCallback(async () => {
    setLoading(true);
    setLocalError('');
    try {
      const [nextJobs, nextSubaccounts, nextAccountManagerStatuses] = await Promise.all([
        apiClient.listSubaccountRegistrationJobs(),
        apiClient.listSubaccounts(),
        apiClient.getSubaccountAccountManagerStatuses()
      ]);
      setSubaccounts(sortSubaccountsForList(nextSubaccounts));
      setRegistrationJobs(nextJobs);
      setAccountManagerStatuses(nextAccountManagerStatuses);
    } catch (error) {
      reportLocalError(error);
    } finally {
      setLoading(false);
      setRegistrationJobsLoaded(true);
    }
  }, [reportLocalError]);

  const loadRuntimeStatus = useCallback(async () => {
    try {
      setRuntimeStatus(await apiClient.getSubaccountRegistrationRuntimeStatus());
    } catch (error) {
      setRuntimeStatus({
        configured: false,
        reachable: false,
        error: (error as Error).message
      });
    }
  }, []);

  const loadAccountProfileStatuses = useCallback(async () => {
    try {
      setAccountProfileStatuses(await apiClient.getSubaccountAccountProfiles());
    } catch {
      // Profile 标签是列表辅助信息，读取失败不阻塞子号工作台。
    }
  }, []);

  const updateAccountProfileStatus = useCallback((id: string, profile: AccountManagerProfileView) => {
    setAccountProfileStatuses((current) => ({ ...current, [id]: profile }));
  }, []);

  const loadAccountManagerStatus = useCallback(async (id: string, background = false) => {
    if (!background) setAccountManagerLoadingId(id);
    try {
      const status = await apiClient.getSubaccountAccountManagerStatus(id);
      setAccountManagerStatuses((current) => ({ ...current, [id]: status }));
      return status;
    } catch (error) {
      if (!background) reportLocalError(error);
      return undefined;
    } finally {
      if (!background) setAccountManagerLoadingId((current) => current === id ? '' : current);
    }
  }, [reportLocalError]);

  const loadLogs = useCallback(
    async (id: string) => {
      setLogsLoaded(false);
      try {
        setLogs(await apiClient.listSubaccountLogs(id));
        setLogsLoaded(true);
      } catch (error) {
        reportLocalError(error);
      }
    },
    [reportLocalError]
  );

  useEffect(() => {
    void loadSubaccounts();
    void loadRuntimeStatus();
    void loadAccountProfileStatuses();
  }, [loadAccountProfileStatuses, loadRuntimeStatus, loadSubaccounts]);

  useEffect(() => {
    if (!selectedSummary) return;
    void loadAccountManagerStatus(selectedSummary.id);
  }, [loadAccountManagerStatus, selectedSummary?.id]);

  const hasActiveRegistration = registrationJobs.some(
    (job) => registrationStatusNeedsPolling(job.status)
  );

  useEffect(() => {
    if (!hasActiveRegistration) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const [nextJobs, nextSubaccounts] = await Promise.all([
          apiClient.listSubaccountRegistrationJobs(),
          apiClient.listSubaccounts()
        ]);
        if (!cancelled) {
          setSubaccounts(sortSubaccountsForList(nextSubaccounts));
          setRegistrationJobs(nextJobs);
          setRegistrationJobsLoaded(true);
        }
      } catch {
        // 后台任务保留在服务端，短暂轮询失败不会清空当前进度。
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1500);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasActiveRegistration]);

  const hasActivePro5xOperation = Object.values(accountManagerStatuses).some(
    subaccountAccountManagerStatusNeedsPolling
  );
  const shouldRetryAccountManagerStatus = Object.values(accountManagerStatuses).some(
    (status) => status.configured && status.reachable === false
  );

  useEffect(() => {
    if (!hasActivePro5xOperation && !shouldRetryAccountManagerStatus) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const statuses = await apiClient.getSubaccountAccountManagerStatuses();
        if (!cancelled) setAccountManagerStatuses(statuses);
      } catch {
        // 后台任务仍保留在 GAM，短暂读取失败不清空列表中的现有进度。
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, hasActivePro5xOperation ? 1500 : 3000);
      }
    };
    timer = window.setTimeout(poll, hasActivePro5xOperation ? 700 : 2000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    hasActivePro5xOperation,
    shouldRetryAccountManagerStatus
  ]);

  useEffect(() => {
    const completed = registrationJobId
      ? registrationJobs.find((job) => job.id === registrationJobId && job.subaccountId)
      : undefined;
    if (!completed?.subaccountId) return;
    const next = clearModalState(searchParams);
    next.set('tab', 'account-manager');
    navigate({
      pathname: `/subaccounts/${completed.subaccountId}`,
      search: toSearch(next)
    }, { replace: true });
  }, [navigate, registrationJobId, registrationJobs, searchParams]);

  useEffect(() => {
    if (registrationJobId) {
      if (!registrationJobsLoaded) return;
      const nextParams = clearModalState(searchParams);
      nextParams.set('tab', 'account-manager');
      const nextPath = selectedRegistrationJob
        ? `/subaccounts/registrations/${registrationJobId}`
        : '/subaccounts';
      if (location.pathname !== nextPath || nextParams.toString() !== searchParams.toString()) {
        navigate({ pathname: nextPath, search: toSearch(nextParams) }, { replace: true });
      }
      return;
    }
    if (loading || subaccounts.length === 0 || searchState.modal) return;
    rememberLocalGroupPreference(SUBACCOUNT_GROUP_PREFERENCE_KEY, activeGroup);
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;
    if ((searchParams.get('group')?.trim() ?? '') !== activeGroup) {
      if (activeGroup === ALL_LOCAL_GROUP) nextParams.delete('group');
      else nextParams.set('group', activeGroup);
      changed = true;
    }
    if (!searchParams.get('tab')) {
      nextParams.set('tab', searchState.tab);
      changed = true;
    }
    const nextPath = selectedSummary ? `/subaccounts/${selectedSummary.id}` : '/subaccounts';
    if (location.pathname !== nextPath || changed) {
      navigate({ pathname: nextPath, search: toSearch(nextParams) }, { replace: true });
    }
  }, [
    activeGroup,
    loading,
    location.pathname,
    navigate,
    registrationJobId,
    registrationJobsLoaded,
    searchParams,
    searchState.modal,
    searchState.tab,
    selectedRegistrationJob,
    selectedSummary,
    subaccounts.length
  ]);

  useEffect(() => {
    setQuota(null);
    setLocalError('');
  }, [selectedSummary?.id]);

  useEffect(() => {
    if (searchState.tab === 'logs' && selectedSummary?.id) void loadLogs(selectedSummary.id);
    else {
      setLogs([]);
      setLogsLoaded(false);
    }
  }, [loadLogs, searchState.tab, selectedSummary?.id]);

  const closeModal = () => {
    const next = clearModalState(searchParams);
    setSearchParams(next);
    setLocalError('');
  };

  const openModal = (modal: SubaccountModal, target = '') => {
    setLocalError('');
    setSearchParams(setModalState(searchParams, modal, target));
  };

  const openSubaccountRecordModal = (subaccount: SubaccountSummaryView, modal: SubaccountModal) => {
    setLocalError('');
    navigate({
      pathname: `/subaccounts/${subaccount.id}`,
      search: toSearch(setModalState(searchParams, modal, subaccount.id))
    });
  };

  const selectSubaccount = (subaccount: SubaccountSummaryView) => {
    navigate({ pathname: `/subaccounts/${subaccount.id}`, search: toSearch(searchParams) });
  };

  const selectRegistrationJob = (job: SubaccountRegistrationJobView) => {
    const next = clearModalState(searchParams);
    next.set('tab', 'account-manager');
    navigate({
      pathname: `/subaccounts/registrations/${job.id}`,
      search: toSearch(next)
    });
  };

  const changeTab = (tab: SubaccountTab) => {
    setSearchParams(setSearchValue(searchParams, 'tab', tab));
  };

  const changeSearchQuery = (query: string) => {
    const next = setSearchValue(searchParams, 'q', query);
    next.set('tab', searchState.tab);
    setSearchParams(next);
  };

  const changeGroup = (group: string) => {
    rememberLocalGroupPreference(SUBACCOUNT_GROUP_PREFERENCE_KEY, group);
    const firstInGroup = group === ALL_LOCAL_GROUP
      ? matchingSubaccounts[0]
      : matchingSubaccounts.find((subaccount) => localGroupName(subaccount) === group);
    const next = setSearchValue(searchParams, 'group', group);
    next.set('tab', searchState.tab);
    navigate({
      pathname: firstInGroup ? `/subaccounts/${firstInGroup.id}` : '/subaccounts',
      search: toSearch(next)
    });
  };

  const importSession = async (payload: unknown) => {
    setLocalError('');
    try {
      await actionBusy.run('import-session', async () => {
        const record = payload && typeof payload === 'object'
          ? payload as { remark?: string; groupName?: string; isBanned?: boolean; proxy?: string; session?: unknown }
          : {};
        if (!record.session) throw new Error('请粘贴 Session JSON');
        const added = await apiClient.importSubaccountSession({
          remark: record.remark ?? '',
          groupName: record.groupName ?? '默认分组',
          isBanned: record.isBanned ?? false,
          proxy: record.proxy ?? '',
          session: record.session
        });
        mergeSubaccount(added);
        closeModal();
        navigate({ pathname: `/subaccounts/${added.id}`, search: '?tab=teams' });
      });
    } catch (error) {
      reportLocalError(error);
      throw error;
    }
  };

  const registerSubaccount = async () => {
    setLocalError('');
    try {
      await actionBusy.run('register-subaccount', async () => {
        const job = await apiClient.registerSubaccount();
        setRegistrationJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
        closeModal();
        void loadRuntimeStatus();
        const next = clearModalState(searchParams);
        next.set('tab', 'account-manager');
        navigate({
          pathname: `/subaccounts/registrations/${job.id}`,
          search: toSearch(next)
        });
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const retryRegistration = async (job: SubaccountRegistrationJobView) => {
    const key = `retry-registration-${job.id}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        const retried = await apiClient.retrySubaccountRegistration(job.id);
        setRegistrationJobs((current) => current.map((item) => (item.id === retried.id ? retried : item)));
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const updateLocalProfile = async (payload: {
    remark?: string;
    groupName?: string;
    isBanned?: boolean;
    proxy?: string;
    session?: unknown;
  }) => {
    if (!selectedSummary) return;
    setLocalError('');
    try {
      await actionBusy.run('edit-subaccount-profile', async () => {
        const updated = await apiClient.updateSubaccountLocalProfile(selectedSummary.id, {
          remark: payload.remark ?? '',
          groupName: payload.groupName ?? '默认分组',
          isBanned: payload.isBanned ?? false,
          proxy: payload.proxy ?? '',
          ...(payload.session ? { session: payload.session } : {})
        });
        const next = setSearchValue(clearModalState(searchParams), 'group', localGroupName(updated));
        navigate({ pathname: `/subaccounts/${updated.id}`, search: toSearch(next) }, { replace: true });
        mergeSubaccount(updated);
      });
    } catch (error) {
      reportLocalError(error);
      throw error;
    }
  };

  const syncSubaccount = async () => {
    if (!selectedSummary) return;
    setLocalError('');
    try {
      await actionBusy.run('subaccount-refresh', async () => {
        mergeSubaccount(await apiClient.refreshSubaccount(selectedSummary.id));
        if (searchState.tab === 'logs') await loadLogs(selectedSummary.id);
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
          await apiClient.provideSubaccountPro5xPaymentCard(target, operation.id, payload);
        } else {
          await apiClient.openSubaccountPro5x(target, payload);
        }
        await loadAccountManagerStatus(target);
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const terminatePro5x = async (subaccountId: string, operationId: string) => {
    const key = `terminate-pro5x-${operationId}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.terminateSubaccountOperation(subaccountId, operationId);
        await loadAccountManagerStatus(subaccountId);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const dismissPro5x = async (subaccountId: string, operationId: string) => {
    const key = `dismiss-pro5x-${operationId}`;
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        await apiClient.dismissSubaccountOperation(subaccountId, operationId);
        await loadAccountManagerStatus(subaccountId);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const deleteSubaccount = async () => {
    if (!deleteTarget) {
      closeModal();
      return;
    }
    const target = deleteTarget;
    setLocalError('');
    try {
      await actionBusy.run('delete-subaccount', async () => {
        await apiClient.removeSubaccount(target.id);
        const nextSelected = subaccountAfterRemoval(subaccounts, target.id);
        const nextParams = clearModalState(searchParams);
        setSubaccounts((current) => sortSubaccountsForList(current.filter((item) => item.id !== target.id)));
        setSubaccountDetails((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
        setAccountManagerStatuses((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
        navigate(
          {
            pathname: nextSelected ? `/subaccounts/${nextSelected.id}` : '/subaccounts',
            search: toSearch(nextParams)
          },
          { replace: true }
        );
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const inviteToTeam = async (values: TeamInviteValues) => {
    if (!selectedSummary) return;
    actionBusy.start('invite-to-team');
    setLocalError('');
    try {
      mergeSubaccount(await apiClient.inviteSubaccountToTeam(selectedSummary.id, values.accountId, values.seat));
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      actionBusy.finish('invite-to-team');
    }
  };

  const createPersonalAccessToken = async (workspaceId: string) => {
    if (!selectedSummary || !workspaceId) return;
    const key = actionKey('pat-create', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        mergeSubaccount(await apiClient.createSubaccountPersonalAccessTokenCredential(selectedSummary.id, workspaceId));
        if (searchState.tab === 'logs') await loadLogs(selectedSummary.id);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const refreshQuota = async (workspaceId: string) => {
    if (!selectedSummary || !workspaceId) return;
    const key = actionKey('quota-refresh', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        setQuota(await apiClient.refreshSubaccountQuota(selectedSummary.id, workspaceId));
        mergeSubaccount(await apiClient.getSubaccount(selectedSummary.id));
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const exportCredential = async (workspaceId: string) => {
    if (!selected || !selectedSummary || !workspaceId) return;
    const key = actionKey('pat-export', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        const credential = await apiClient.getSubaccountCodexCredential(selectedSummary.id, workspaceId);
        downloadTextFile(buildCredentialDownload(selected, workspaceId, credential));
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const deleteCredential = async () => {
    if (!selectedSummary || !searchState.target) return;
    const workspaceId = searchState.target;
    const key = actionKey('pat-delete', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        mergeSubaccount(await apiClient.removeSubaccountCodexCredential(selectedSummary.id, workspaceId));
        setQuota(null);
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  return (
    <div className="workbench">
      <SubaccountList
        subaccounts={subaccounts}
        registrationJobs={registrationJobs}
        accountProfileStatuses={accountProfileStatuses}
        accountManagerStatuses={accountManagerStatuses}
        groups={groups}
        activeGroup={activeGroup}
        searchQuery={searchQuery}
        selectedId={selectedSummary?.id ?? ''}
        selectedRegistrationId={registrationJobId}
        runtimeStatus={runtimeStatus}
        isBusy={actionBusy.isBusy}
        onSelect={selectSubaccount}
        onGroupChange={changeGroup}
        onSearchChange={changeSearchQuery}
        onOpenImportSession={() => openModal('import-session')}
        onOpenRegister={() => openModal('register-subaccount')}
        onRetryRegistration={(job) => void retryRegistration(job)}
        onSelectRegistration={selectRegistrationJob}
        onTerminateOperation={(subaccount, operation) => {
          void terminatePro5x(subaccount.id, operation.id);
        }}
        onDismissOperation={(subaccount, operation) => {
          void dismissPro5x(subaccount.id, operation.id);
        }}
        onOpenEdit={(subaccount) => {
          openSubaccountRecordModal(subaccount, 'edit-subaccount-profile');
        }}
        onOpenDelete={(subaccount) => {
          openSubaccountRecordModal(subaccount, 'delete-subaccount');
        }}
      />

      <Space direction="vertical" size={12} className="content-pane">
        {localError && <Alert type="error" showIcon message={localError} />}
        {selectedRegistrationJob ? (
          <PendingRegistrationAccountManagerDetail
            recordLabel="子号"
            operationId={selectedRegistrationJob.id}
            email={selectedRegistrationJob.email}
            message={selectedRegistrationJob.message}
            progress={selectedRegistrationJob.progress}
            failed={selectedRegistrationJob.status === 'failed'
              || selectedRegistrationJob.status === 'interrupted'}
            waitingManual={selectedRegistrationJob.status === 'waiting_manual'}
          />
        ) : (
          <SubaccountDetail
            subaccount={selected}
            accounts={accounts}
            loading={Boolean(selectedSummary) && !selected && detailLoadingId === selectedSummary?.id}
            activeTab={searchState.tab}
            logs={logs}
            logsLoaded={logsLoaded}
            busyState={actionBusy.busyState}
            accountManagerStatus={accountManagerStatus}
            accountManagerLoading={accountManagerLoadingId === selectedSummary?.id}
            quota={quota}
            syncing={actionBusy.isBusy('subaccount-refresh')}
            onTabChange={changeTab}
            onSubaccountChanged={mergeSubaccount}
            onAccountProfileChanged={(profile) => {
              if (selectedSummary) updateAccountProfileStatus(selectedSummary.id, profile);
            }}
            onOpenEdit={() => selectedSummary && openModal('edit-subaccount-profile', selectedSummary.id)}
            onOpenDelete={() => selectedSummary && openModal('delete-subaccount', selectedSummary.id)}
            onOpenPro5x={() => selectedSummary && openModal('open-pro-5x', selectedSummary.id)}
            onTerminatePro5x={(operationId) => {
              if (selectedSummary) void terminatePro5x(selectedSummary.id, operationId);
            }}
            onDismissPro5x={(operationId) => {
              if (selectedSummary) void dismissPro5x(selectedSummary.id, operationId);
            }}
            onSync={() => void syncSubaccount()}
            onOpenInvite={() => openModal('invite-to-team', selectedSummary?.id ?? '')}
            onCreatePat={(workspaceId) => void createPersonalAccessToken(workspaceId)}
            onRefreshQuota={(workspaceId) => void refreshQuota(workspaceId)}
            onExportPat={(workspaceId) => void exportCredential(workspaceId)}
            onOpenDeletePat={(workspaceId) => openModal('delete-pat-credential', workspaceId)}
          />
        )}
      </Space>

      <LocalProfileModal
        open={searchState.modal === 'import-session'}
        mode="subaccount"
        title="录入子号 Session"
        description="保存子号本地记录后，可继续生成 Codex 凭证并查询额度。粘贴 chatgpt.com session JSON，建议包含 sessionToken。"
        submitLabel="保存子号"
        requireSession
        initialValues={{ remark: '', groupName: '默认分组', isBanned: false, proxy: '' }}
        confirmLoading={actionBusy.isBusy('import-session')}
        onCancel={closeModal}
        onSubmit={importSession}
      />

      <LocalProfileModal
        open={searchState.modal === 'edit-subaccount-profile' && Boolean(selectedSummary)}
        mode="subaccount"
        title="编辑子号本地资料"
        description="只更新本系统保存的备注、分组、封号标记、代理地址和 Web session，不修改 Codex 凭证。粘贴 chatgpt.com session JSON，建议包含 sessionToken。"
        initialValues={{
          remark: localProfile?.remark ?? selectedSummary?.remark ?? '',
          groupName: localProfile?.groupName ?? selectedSummary?.groupName ?? '默认分组',
          isBanned: localProfile?.isBanned ?? selectedSummary?.isBanned ?? false,
          proxy: localProfile?.proxy ?? '',
          session: localProfile?.session
        }}
        loading={localProfileLoading}
        confirmLoading={actionBusy.isBusy('edit-subaccount-profile')}
        onCancel={closeModal}
        onSubmit={updateLocalProfile}
      />

      <Modal
        open={searchState.modal === 'register-subaccount'}
        title="自动注册子号"
        okText="开始注册"
        cancelText="取消"
        confirmLoading={actionBusy.isBusy('register-subaccount')}
        onCancel={closeModal}
        onOk={() => void registerSubaccount()}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <span>系统会取一个 GongXi-Mail 邮箱，完成账号注册、资料与密码设置，获取 chatgpt.com Web Session，录入为子号，最后把邮箱转移到已注册分组。本按钮不会生成 Codex 凭证。</span>
          <ModalErrorAlert message={searchState.modal === 'register-subaccount' ? localError : ''} />
        </Space>
      </Modal>

      <OpenPro5xModal
        open={searchState.modal === 'open-pro-5x'}
        confirmLoading={actionBusy.isBusy('open-pro-5x')}
        error={searchState.modal === 'open-pro-5x' ? localError : ''}
        mode={accountManagerStatus?.pro5xOperation?.phase === 'pro5x_payment_card_required'
          ? 'resume'
          : 'open'}
        onCancel={closeModal}
        onSubmit={submitPro5x}
      />

      <Modal
        open={searchState.modal === 'delete-subaccount' && Boolean(deleteTarget)}
        title="删除子号"
        okText="删除子号"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: actionBusy.isBusy('delete-subaccount') }}
        onCancel={closeModal}
        onOk={() => void deleteSubaccount()}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <span>仅从本系统移除 {deleteTarget?.remark || deleteTarget?.email} 的本地记录，不会移除 ChatGPT Team 成员。</span>
          <ModalErrorAlert message={searchState.modal === 'delete-subaccount' ? localError : ''} />
        </Space>
      </Modal>

      <Modal
        open={searchState.modal === 'invite-to-team' && Boolean(selectedSummary)}
        title="邀请子号加入 Team"
        okText="发送邀请"
        cancelText="取消"
        confirmLoading={actionBusy.isBusy('invite-to-team')}
        onCancel={closeModal}
        onOk={() => inviteForm.submit()}
        destroyOnClose
      >
        <Form<TeamInviteValues>
          form={inviteForm}
          layout="vertical"
          disabled={actionBusy.isBusy('invite-to-team')}
          initialValues={{ seat: 'usage_based' }}
          onFinish={(values) => void inviteToTeam(values)}
        >
          <Form.Item name="accountId" label="目标 Team" rules={[{ required: true, message: '请选择目标 Team' }]}>
            <Select options={accountOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="seat" label="席位类型" rules={[{ required: true, message: '请选择席位类型' }]}>
            <Select<SeatType>
              options={[
                { value: 'usage_based', label: SEAT_LABEL.usage_based },
                { value: 'default', label: SEAT_LABEL.default }
              ]}
            />
          </Form.Item>
        </Form>
        <ModalErrorAlert message={searchState.modal === 'invite-to-team' ? localError : ''} />
      </Modal>

      <Modal
        open={searchState.modal === 'delete-pat-credential' && Boolean(selectedSummary)}
        title="删除 PAT 凭证"
        okText="删除 PAT"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: actionBusy.isBusy(actionKey('pat-delete', searchState.target)) }}
        onCancel={closeModal}
        onOk={() => void deleteCredential()}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <span>确认删除 workspace {searchState.target || '当前'} 的 PAT 凭证？这不会移除 Team 成员关系。</span>
          <ModalErrorAlert message={searchState.modal === 'delete-pat-credential' ? localError : ''} />
        </Space>
      </Modal>

    </div>
  );
}
