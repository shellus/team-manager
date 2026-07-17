import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccountView,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  SeatType,
  SubaccountAuthLog,
  SubaccountRegistrationJobView,
  SubaccountView
} from '@team-manager/shared';
import { Alert, Form, Input, Modal, Select, Space } from 'antd';
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
import { BillingRiskModal } from '../../components/BillingRiskModal.js';
import { actionKey, actionTargetByPrefix } from '../../components/actionBusy.js';
import { isBillingRiskError } from '../../components/format.js';
import { JsonImportModal } from '../../components/JsonImportModal.js';
import { LocalProfileModal } from '../../components/LocalProfileModal.js';
import { ModalErrorAlert } from '../../components/ModalErrorAlert.js';
import { useActionBusy } from '../../components/useActionBusy.js';
import { SEAT_LABEL } from '../../labels.js';
import { buildCredentialDownload, buildWorkspaceSessionDownload, downloadTextFile } from './credentialDownload.js';
import { shouldForwardSubaccountErrorToGlobal } from './errorHandling.js';
import { SubaccountDetail } from './SubaccountDetail.js';
import { SubaccountList } from './SubaccountList.js';
import {
  resolveSubaccountDeleteTarget,
  sortSubaccountsForList,
  subaccountAfterRemoval
} from './subaccountListState.js';

interface TeamInviteValues {
  accountId: string;
  seat: SeatType;
}

interface ManualAuthSession {
  sessionId: string;
  authUrl: string;
  expiresAt: number;
  targetChatgptAccountId?: string;
  targetTeamTitle?: string;
}

interface SubaccountBillingRisk {
  kind: 'team-invite';
  accountId: string;
  seat: SeatType;
}

function toSearch(params: URLSearchParams): string {
  const value = params.toString();
  return value ? `?${value}` : '';
}

function accountDisplayName(account: AccountView): string {
  return account.remark || account.workspaceName || account.email;
}

function accountOptionLabel(account: AccountView): string {
  const primary = accountDisplayName(account);
  return primary === account.email ? primary : `${primary} · ${account.email}`;
}

export function SubaccountRoutes({
  accounts,
  onError
}: {
  accounts: AccountView[];
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { subaccountId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = parseSubaccountSearchState(searchParams);
  const [inviteForm] = Form.useForm<TeamInviteValues>();

  const [subaccounts, setSubaccounts] = useState<SubaccountView[]>([]);
  const [registrationJobs, setRegistrationJobs] = useState<SubaccountRegistrationJobView[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<CodexAuthRuntimeStatus | null>(null);
  const [logs, setLogs] = useState<SubaccountAuthLog[]>([]);
  const [authSession, setAuthSession] = useState<ManualAuthSession | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null);
  const [billingRisk, setBillingRisk] = useState<SubaccountBillingRisk | null>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const actionBusy = useActionBusy();

  const selected = subaccounts.find((subaccount) => subaccount.id === subaccountId) ?? subaccounts[0] ?? null;
  const deleteTarget =
    searchState.modal === 'delete-subaccount'
      ? resolveSubaccountDeleteTarget(subaccounts, selected, searchState.target)
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
    setSubaccounts((current) => {
      const exists = current.some((item) => item.id === updated.id);
      const next = exists
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current];
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

  const loadSubaccounts = useCallback(async () => {
    setLoading(true);
    setLocalError('');
    try {
      const [nextSubaccounts, nextJobs] = await Promise.all([
        apiClient.listSubaccounts(),
        apiClient.listSubaccountRegistrationJobs()
      ]);
      setSubaccounts(sortSubaccountsForList(nextSubaccounts));
      setRegistrationJobs(nextJobs);
    } catch (error) {
      reportLocalError(error);
    } finally {
      setLoading(false);
    }
  }, [reportLocalError]);

  const loadRuntimeStatus = useCallback(async () => {
    try {
      setRuntimeStatus(await apiClient.getCodexAuthRuntimeStatus());
    } catch (error) {
      setRuntimeStatus({
        workerConfigured: false,
        workerReachable: false,
        codexAutoAuth: false,
        subaccountRegistration: false,
        flaresolverr: false,
        gongxiMail: false,
        phoneOtp: false,
        error: (error as Error).message
      });
    }
  }, []);

  const loadLogs = useCallback(
    async (id: string) => {
      try {
        setLogs(await apiClient.listSubaccountLogs(id));
      } catch (error) {
        reportLocalError(error);
      }
    },
    [reportLocalError]
  );

  useEffect(() => {
    void loadSubaccounts();
    void loadRuntimeStatus();
  }, [loadRuntimeStatus, loadSubaccounts]);

  const hasActiveRegistration = registrationJobs.some(
    (job) => job.status === 'queued' || job.status === 'running'
  );

  useEffect(() => {
    if (!hasActiveRegistration) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const [nextSubaccounts, nextJobs] = await Promise.all([
          apiClient.listSubaccounts(),
          apiClient.listSubaccountRegistrationJobs()
        ]);
        if (!cancelled) {
          setSubaccounts(sortSubaccountsForList(nextSubaccounts));
          setRegistrationJobs(nextJobs);
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

  useEffect(() => {
    if (loading || subaccounts.length === 0) return;
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;
    if (!searchParams.get('tab')) {
      nextParams.set('tab', searchState.tab);
      changed = true;
    }
    const nextPath = selected ? `/subaccounts/${selected.id}` : '/subaccounts';
    if (location.pathname !== nextPath || changed) {
      navigate({ pathname: nextPath, search: toSearch(nextParams) }, { replace: true });
    }
  }, [loading, location.pathname, navigate, searchParams, searchState.tab, selected, subaccounts.length]);

  useEffect(() => {
    setQuota(null);
    setAuthSession(null);
    setCallbackUrl('');
    setBillingRisk(null);
    setLocalError('');
    if (selected?.id) void loadLogs(selected.id);
    else setLogs([]);
  }, [loadLogs, selected?.id]);

  const runningTarget = actionTargetByPrefix(actionBusy.busyState, 'codex-auto-');

  useEffect(() => {
    if (!selected?.id || !runningTarget) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const nextLogs = await apiClient.listSubaccountLogs(selected.id);
        if (!cancelled) setLogs(nextLogs);
      } catch {
        // 自动授权主请求负责报告错误，轮询失败不覆盖页面状态。
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 2000);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runningTarget, selected?.id]);

  const closeModal = () => {
    const next = clearModalState(searchParams);
    next.delete('seat');
    next.delete('risk');
    setSearchParams(next);
    setBillingRisk(null);
    setLocalError('');
  };

  const openModal = (modal: SubaccountModal, target = '') => {
    setLocalError('');
    setSearchParams(setModalState(searchParams, modal, target));
  };

  const openSubaccountRecordModal = (subaccount: SubaccountView, modal: SubaccountModal) => {
    setLocalError('');
    navigate({
      pathname: `/subaccounts/${subaccount.id}`,
      search: toSearch(setModalState(searchParams, modal, subaccount.id))
    });
  };

  const selectSubaccount = (subaccount: SubaccountView) => {
    navigate({ pathname: `/subaccounts/${subaccount.id}`, search: toSearch(searchParams) });
  };

  const changeTab = (tab: SubaccountTab) => {
    setSearchParams(setSearchValue(searchParams, 'tab', tab));
  };

  const importSession = async (payload: unknown) => {
    setLocalError('');
    try {
      await actionBusy.run('import-session', async () => {
        const record = payload && typeof payload === 'object' ? payload as { remark?: string; proxy?: string; session?: unknown } : {};
        if (!record.session) throw new Error('请粘贴 Session JSON');
        const added = await apiClient.importSubaccountSession({
          remark: record.remark ?? '',
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

  const importCredential = async (payload: unknown) => {
    setLocalError('');
    try {
      await actionBusy.run('import-credential', async () => {
        const added = await apiClient.importSubaccountCodexCredential(
          payload as { credential: Record<string, unknown>; fileName?: string; groupName?: string }
        );
        mergeSubaccount(added);
        closeModal();
        navigate({ pathname: `/subaccounts/${added.id}`, search: '?tab=credential' });
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

  const updateLocalProfile = async (payload: { remark?: string; proxy?: string; session?: unknown }) => {
    if (!selected) return;
    setLocalError('');
    try {
      await actionBusy.run('edit-subaccount-profile', async () => {
        const updated = await apiClient.updateSubaccountLocalProfile(selected.id, {
          remark: payload.remark ?? '',
          proxy: payload.proxy ?? '',
          ...(payload.session ? { session: payload.session } : {})
        });
        mergeSubaccount(updated);
        closeModal();
      });
    } catch (error) {
      reportLocalError(error);
      throw error;
    }
  };

  const syncSubaccount = async () => {
    if (!selected) return;
    setLocalError('');
    try {
      await actionBusy.run('subaccount-refresh', async () => {
        mergeSubaccount(await apiClient.refreshSubaccount(selected.id));
        await loadLogs(selected.id);
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
        nextParams.delete('seat');
        nextParams.delete('risk');
        setSubaccounts((current) => sortSubaccountsForList(current.filter((item) => item.id !== target.id)));
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

  const openBillingRisk = (risk: SubaccountBillingRisk) => {
    setLocalError('');
    const next = setModalState(searchParams, 'billing-risk', risk.accountId);
    next.set('risk', risk.kind);
    next.set('seat', risk.seat);
    setBillingRisk(risk);
    setSearchParams(next);
  };

  const inviteToTeam = async (values: TeamInviteValues, confirmBillingRisk = false) => {
    if (!selected) return;
    actionBusy.start('invite-to-team');
    setLocalError('');
    try {
      mergeSubaccount(await apiClient.inviteSubaccountToTeam(selected.id, values.accountId, values.seat, confirmBillingRisk));
      closeModal();
    } catch (error) {
      if (isBillingRiskError(error)) {
        openBillingRisk({ kind: 'team-invite', accountId: values.accountId, seat: values.seat });
      } else {
        reportLocalError(error);
      }
    } finally {
      actionBusy.finish('invite-to-team');
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
      mergeSubaccount(await apiClient.inviteSubaccountToTeam(selected.id, billingRisk.accountId, billingRisk.seat, true));
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      actionBusy.finish('billing-risk');
    }
  };

  const startAuth = async (workspaceId: string, teamTitle: string) => {
    if (!selected || !workspaceId) return;
    const key = actionKey('codex-start', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        setAuthSession({
          ...(await apiClient.startSubaccountCodexAuth(selected.id, workspaceId)),
          targetTeamTitle: teamTitle
        });
        openModal('manual-codex-callback', workspaceId);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const autoAuth = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = actionKey('codex-auto', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        mergeSubaccount(await apiClient.autoSubaccountCodexAuth(selected.id, workspaceId));
        setAuthSession(null);
        setCallbackUrl('');
        void loadRuntimeStatus();
        await loadLogs(selected.id);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const createPersonalAccessToken = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = actionKey('codex-pat', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        const link = selected.teamLinks.find((item) => item.workspaceId === workspaceId || item.accountId === workspaceId);
        const updated =
          link?.planType === 'k12'
            ? await apiClient.createSubaccountK12Credential(selected.id, workspaceId)
            : await apiClient.createSubaccountPersonalAccessTokenCredential(selected.id, workspaceId);
        mergeSubaccount(updated);
        await loadLogs(selected.id);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const completeManualAuth = async () => {
    if (!selected || !authSession) return;
    setLocalError('');
    try {
      await actionBusy.run('codex-callback', async () => {
        mergeSubaccount(await apiClient.completeSubaccountCodexAuth(selected.id, authSession.sessionId, callbackUrl.trim()));
        setAuthSession(null);
        setCallbackUrl('');
        closeModal();
        await loadLogs(selected.id);
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const refreshQuota = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = actionKey('quota-refresh', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        setQuota(await apiClient.refreshSubaccountQuota(selected.id, workspaceId));
        setSubaccounts(sortSubaccountsForList(await apiClient.listSubaccounts()));
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const exportCredential = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = actionKey('credential-export', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        const credential = await apiClient.getSubaccountCodexCredential(selected.id, workspaceId);
        downloadTextFile(buildCredentialDownload(selected, workspaceId, credential));
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const exportWorkspaceSession = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = actionKey('workspace-session-export', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        const session = await apiClient.getSubaccountWorkspaceSession(selected.id, workspaceId);
        downloadTextFile(buildWorkspaceSessionDownload(selected, workspaceId, session));
      });
    } catch (error) {
      reportLocalError(error);
    }
  };

  const deleteCredential = async () => {
    if (!selected || !searchState.target) return;
    const workspaceId = searchState.target;
    const key = actionKey('credential-delete', workspaceId);
    setLocalError('');
    try {
      await actionBusy.run(key, async () => {
        mergeSubaccount(await apiClient.removeSubaccountCodexCredential(selected.id, workspaceId));
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
        selectedId={selected?.id ?? ''}
        runtimeStatus={runtimeStatus}
        isBusy={actionBusy.isBusy}
        onSelect={selectSubaccount}
        onOpenImportSession={() => openModal('import-session')}
        onOpenImportCredential={() => openModal('import-credential')}
        onOpenRegister={() => openModal('register-subaccount')}
        onRetryRegistration={(job) => void retryRegistration(job)}
        onOpenEdit={(subaccount) => {
          openSubaccountRecordModal(subaccount, 'edit-subaccount-profile');
        }}
        onOpenDelete={(subaccount) => {
          openSubaccountRecordModal(subaccount, 'delete-subaccount');
        }}
      />

      <Space direction="vertical" size={12} className="content-pane">
        {localError && <Alert type="error" showIcon message={localError} />}
        <SubaccountDetail
          subaccount={selected}
          accounts={accounts}
          activeTab={searchState.tab}
          runtimeStatus={runtimeStatus}
          logs={logs}
          busyState={actionBusy.busyState}
          quota={quota}
          runningTarget={runningTarget}
          syncing={actionBusy.isBusy('subaccount-refresh')}
          onTabChange={changeTab}
          onSubaccountChanged={mergeSubaccount}
          onOpenEdit={() => selected && openModal('edit-subaccount-profile', selected.id)}
          onOpenDelete={() => selected && openModal('delete-subaccount', selected.id)}
          onSync={() => void syncSubaccount()}
          onOpenInvite={() => openModal('invite-to-team', selected?.id ?? '')}
          onStartAuth={(workspaceId, teamTitle) => void startAuth(workspaceId, teamTitle)}
          onAutoAuth={(workspaceId) => void autoAuth(workspaceId)}
          onCreatePersonalAccessToken={(workspaceId) => void createPersonalAccessToken(workspaceId)}
          onRefreshQuota={(workspaceId) => void refreshQuota(workspaceId)}
          onExportWorkspaceSession={(workspaceId) => void exportWorkspaceSession(workspaceId)}
          onExportCredential={(workspaceId) => void exportCredential(workspaceId)}
          onOpenDeleteCredential={(workspaceId) => openModal('delete-codex-credential', workspaceId)}
        />
      </Space>

      <LocalProfileModal
        open={searchState.modal === 'import-session'}
        mode="subaccount"
        title="录入子号 Session"
        description="保存子号本地记录后，可继续生成 Codex 凭证并查询额度。粘贴 chatgpt.com session JSON，建议包含 sessionToken。"
        submitLabel="保存子号"
        requireSession
        initialValues={{ remark: '', proxy: '' }}
        confirmLoading={actionBusy.isBusy('import-session')}
        onCancel={closeModal}
        onSubmit={importSession}
      />

      <JsonImportModal
        open={searchState.modal === 'import-credential'}
        mode="credential"
        title="导入 Codex 凭证"
        description="导入已有 CPA/Codex auth JSON，系统按 workspace 保存凭证，不会创建 Web session。"
        submitLabel="导入凭证"
        confirmLoading={actionBusy.isBusy('import-credential')}
        onCancel={closeModal}
        onSubmit={importCredential}
      />

      <LocalProfileModal
        open={searchState.modal === 'edit-subaccount-profile' && Boolean(selected)}
        mode="subaccount"
        title="编辑子号本地资料"
        description="只更新本系统保存的备注名和 Web session，不修改 Codex 凭证。粘贴 chatgpt.com session JSON，建议包含 sessionToken。"
        initialValues={{
          remark: selected?.remark ?? '',
          proxy: selected?.proxy ?? '',
          session: selected?.session
        }}
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
        open={searchState.modal === 'invite-to-team' && Boolean(selected)}
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
        open={searchState.modal === 'manual-codex-callback' && Boolean(authSession)}
        title={`手动授权回调${authSession?.targetTeamTitle ? ` · ${authSession.targetTeamTitle}` : ''}`}
        okText="提交回调并生成凭证"
        cancelText="取消"
        confirmLoading={actionBusy.isBusy('codex-callback')}
        onCancel={closeModal}
        onOk={() => void completeManualAuth()}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <Input.TextArea rows={4} value={authSession?.authUrl ?? ''} readOnly spellCheck={false} />
          <Input.TextArea
            rows={5}
            value={callbackUrl}
            disabled={actionBusy.isBusy('codex-callback')}
            spellCheck={false}
            placeholder="粘贴授权回调 URL"
            onChange={(event) => setCallbackUrl(event.target.value)}
          />
          <ModalErrorAlert message={searchState.modal === 'manual-codex-callback' ? localError : ''} />
        </Space>
      </Modal>

      <Modal
        open={searchState.modal === 'delete-codex-credential' && Boolean(selected)}
        title="删除 Codex 凭证"
        okText="删除凭证"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: actionBusy.isBusy(actionKey('credential-delete', searchState.target)) }}
        onCancel={closeModal}
        onOk={() => void deleteCredential()}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <span>确认删除 workspace {searchState.target || '当前'} 的 Codex 凭证？这不会移除 Team 成员关系。</span>
          <ModalErrorAlert message={searchState.modal === 'delete-codex-credential' ? localError : ''} />
        </Space>
      </Modal>

      <BillingRiskModal
        open={searchState.modal === 'billing-risk'}
        confirmLoading={actionBusy.isBusy('billing-risk')}
        error={searchState.modal === 'billing-risk' ? localError : ''}
        onCancel={closeModal}
        onConfirm={() => void confirmBillingRisk()}
      />
    </div>
  );
}
