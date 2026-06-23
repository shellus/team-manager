import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccountView,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  SeatType,
  SubaccountAuthLog,
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
import { isBillingRiskError } from '../../components/format.js';
import { JsonImportModal } from '../../components/JsonImportModal.js';
import { LocalProfileModal } from '../../components/LocalProfileModal.js';
import { SEAT_LABEL } from '../../labels.js';
import { SubaccountDetail } from './SubaccountDetail.js';
import { SubaccountList } from './SubaccountList.js';

interface TeamInviteValues {
  accountId: string;
  seat: SeatType;
}

interface ManualAuthSession {
  sessionId: string;
  authUrl: string;
  expiresAt: number;
  targetChatgptAccountId?: string;
  targetLabel?: string;
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

function targetKey(prefix: string, accountId?: string): string {
  return `${prefix}-${accountId || 'default'}`;
}

function accountLabel(account: AccountView): string {
  return account.note || account.workspaceName || account.label;
}

export function SubaccountRoutes({
  accounts,
  globalError,
  onError
}: {
  accounts: AccountView[];
  globalError: string;
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { subaccountId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchState = parseSubaccountSearchState(searchParams);
  const [inviteForm] = Form.useForm<TeamInviteValues>();

  const [subaccounts, setSubaccounts] = useState<SubaccountView[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<CodexAuthRuntimeStatus | null>(null);
  const [logs, setLogs] = useState<SubaccountAuthLog[]>([]);
  const [authSession, setAuthSession] = useState<ManualAuthSession | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [credentialJson, setCredentialJson] = useState('');
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null);
  const [billingRisk, setBillingRisk] = useState<SubaccountBillingRisk | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');

  const selected = subaccounts.find((subaccount) => subaccount.id === subaccountId) ?? subaccounts[0] ?? null;
  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${accountLabel(account)} · ${account.label}`
      })),
    [accounts]
  );

  const mergeSubaccount = useCallback((updated: SubaccountView) => {
    setSubaccounts((current) => {
      const exists = current.some((item) => item.id === updated.id);
      const next = exists
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current];
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const reportLocalError = useCallback(
    (error: unknown) => {
      setLocalError((error as Error).message);
      onError(error);
    },
    [onError]
  );

  const loadSubaccounts = useCallback(async () => {
    setLoading(true);
    setLocalError('');
    try {
      setSubaccounts(await apiClient.listSubaccounts());
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
    setCredentialJson('');
    setQuota(null);
    setAuthSession(null);
    setCallbackUrl('');
    setBillingRisk(null);
    setLocalError('');
    if (selected?.id) void loadLogs(selected.id);
    else setLogs([]);
  }, [loadLogs, selected?.id]);

  const runningTarget = busy.startsWith('codex-auto-') ? busy.slice('codex-auto-'.length) : '';

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
    setSearchParams(setModalState(searchParams, modal, target));
  };

  const selectSubaccount = (subaccount: SubaccountView) => {
    navigate({ pathname: `/subaccounts/${subaccount.id}`, search: toSearch(searchParams) });
  };

  const changeTab = (tab: SubaccountTab) => {
    setSearchParams(setSearchValue(searchParams, 'tab', tab));
  };

  const importSession = async (payload: Record<string, unknown>) => {
    setBusy('import-session');
    setLocalError('');
    try {
      const added = await apiClient.importSubaccountSession(payload);
      mergeSubaccount(added);
      closeModal();
      navigate({ pathname: `/subaccounts/${added.id}`, search: '?tab=teams' });
    } catch (error) {
      reportLocalError(error);
      throw error;
    } finally {
      setBusy('');
    }
  };

  const importCredential = async (payload: Record<string, unknown>) => {
    setBusy('import-credential');
    setLocalError('');
    try {
      const added = await apiClient.importSubaccountCodexCredential(
        payload as { credential: Record<string, unknown>; fileName?: string; groupName?: string }
      );
      mergeSubaccount(added);
      closeModal();
      navigate({ pathname: `/subaccounts/${added.id}`, search: '?tab=credential' });
    } catch (error) {
      reportLocalError(error);
      throw error;
    } finally {
      setBusy('');
    }
  };

  const registerSubaccount = async () => {
    setBusy('register-subaccount');
    setLocalError('');
    try {
      const registered = await apiClient.registerSubaccount();
      mergeSubaccount(registered);
      closeModal();
      navigate({ pathname: `/subaccounts/${registered.id}`, search: '?tab=credential' });
      void loadRuntimeStatus();
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const updateLocalProfile = async (payload: { label?: string; session?: Record<string, unknown> }) => {
    if (!selected || !payload.label) return;
    setBusy('edit-subaccount-profile');
    setLocalError('');
    try {
      const updated = await apiClient.updateSubaccountLocalProfile(selected.id, {
        label: payload.label,
        ...(payload.session ? { session: payload.session } : {})
      });
      mergeSubaccount(updated);
      closeModal();
    } catch (error) {
      reportLocalError(error);
      throw error;
    } finally {
      setBusy('');
    }
  };

  const deleteSubaccount = async () => {
    if (!selected) return;
    setBusy('delete-subaccount');
    setLocalError('');
    try {
      await apiClient.removeSubaccount(selected.id);
      setSubaccounts((current) => current.filter((item) => item.id !== selected.id));
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const openBillingRisk = (risk: SubaccountBillingRisk) => {
    const next = setModalState(searchParams, 'billing-risk', risk.accountId);
    next.set('risk', risk.kind);
    next.set('seat', risk.seat);
    setBillingRisk(risk);
    setSearchParams(next);
  };

  const inviteToTeam = async (values: TeamInviteValues, confirmBillingRisk = false) => {
    if (!selected) return;
    setBusy('invite-to-team');
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
      mergeSubaccount(await apiClient.inviteSubaccountToTeam(selected.id, billingRisk.accountId, billingRisk.seat, true));
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const startAuth = async (workspaceId: string, label: string) => {
    if (!selected || !workspaceId) return;
    const key = targetKey('codex-start', workspaceId);
    setBusy(key);
    setLocalError('');
    try {
      setAuthSession({ ...(await apiClient.startSubaccountCodexAuth(selected.id, workspaceId)), targetLabel: label });
      openModal('manual-codex-callback', workspaceId);
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const autoAuth = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = targetKey('codex-auto', workspaceId);
    setBusy(key);
    setLocalError('');
    try {
      mergeSubaccount(await apiClient.autoSubaccountCodexAuth(selected.id, workspaceId));
      setAuthSession(null);
      setCallbackUrl('');
      void loadRuntimeStatus();
      await loadLogs(selected.id);
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const completeManualAuth = async () => {
    if (!selected || !authSession) return;
    setBusy('codex-callback');
    setLocalError('');
    try {
      mergeSubaccount(await apiClient.completeSubaccountCodexAuth(selected.id, authSession.sessionId, callbackUrl.trim()));
      setAuthSession(null);
      setCallbackUrl('');
      closeModal();
      await loadLogs(selected.id);
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const refreshQuota = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = targetKey('quota-refresh', workspaceId);
    setBusy(key);
    setLocalError('');
    try {
      setQuota(await apiClient.refreshSubaccountQuota(selected.id, workspaceId));
      setSubaccounts(await apiClient.listSubaccounts());
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const exportCredential = async (workspaceId: string) => {
    if (!selected || !workspaceId) return;
    const key = targetKey('credential-export', workspaceId);
    setBusy(key);
    setLocalError('');
    try {
      setCredentialJson(JSON.stringify(await apiClient.getSubaccountCodexCredential(selected.id, workspaceId), null, 2));
      setSearchParams(setSearchValue(searchParams, 'credential', workspaceId));
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  const deleteCredential = async () => {
    if (!selected || !searchState.target) return;
    const workspaceId = searchState.target;
    const key = targetKey('credential-delete', workspaceId);
    setBusy(key);
    setLocalError('');
    try {
      mergeSubaccount(await apiClient.removeSubaccountCodexCredential(selected.id, workspaceId));
      setCredentialJson('');
      setQuota(null);
      closeModal();
    } catch (error) {
      reportLocalError(error);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="workbench">
      <SubaccountList
        subaccounts={subaccounts}
        selectedId={selected?.id ?? ''}
        runtimeStatus={runtimeStatus}
        busy={busy}
        onSelect={selectSubaccount}
        onOpenImportSession={() => openModal('import-session')}
        onOpenImportCredential={() => openModal('import-credential')}
        onOpenRegister={() => openModal('register-subaccount')}
        onOpenEdit={(subaccount) => {
          selectSubaccount(subaccount);
          openModal('edit-subaccount-profile', subaccount.id);
        }}
        onOpenDelete={(subaccount) => {
          selectSubaccount(subaccount);
          openModal('delete-subaccount', subaccount.id);
        }}
      />

      <Space direction="vertical" size={12} className="content-pane">
        {(globalError || localError) && <Alert type="error" showIcon message={localError || globalError} />}
        <SubaccountDetail
          subaccount={selected}
          accounts={accounts}
          activeTab={searchState.tab}
          runtimeStatus={runtimeStatus}
          logs={logs}
          busy={busy}
          credentialJson={credentialJson}
          quota={quota}
          runningTarget={runningTarget}
          onTabChange={changeTab}
          onSubaccountChanged={mergeSubaccount}
          onOpenEdit={() => selected && openModal('edit-subaccount-profile', selected.id)}
          onOpenDelete={() => selected && openModal('delete-subaccount', selected.id)}
          onOpenInvite={() => openModal('invite-to-team', selected?.id ?? '')}
          onRefreshRuntime={() => void loadRuntimeStatus()}
          onStartAuth={(workspaceId, label) => void startAuth(workspaceId, label)}
          onAutoAuth={(workspaceId) => void autoAuth(workspaceId)}
          onRefreshQuota={(workspaceId) => void refreshQuota(workspaceId)}
          onExportCredential={(workspaceId) => void exportCredential(workspaceId)}
          onOpenDeleteCredential={(workspaceId) => openModal('delete-codex-credential', workspaceId)}
        />
      </Space>

      <JsonImportModal
        open={searchState.modal === 'import-session'}
        mode="session"
        title="录入子号 Session"
        description="保存子号本地记录后，可继续生成 Codex 凭证并查询额度。"
        submitLabel="保存子号"
        confirmLoading={busy === 'import-session'}
        onCancel={closeModal}
        onSubmit={importSession}
      />

      <JsonImportModal
        open={searchState.modal === 'import-credential'}
        mode="credential"
        title="导入 Codex 凭证"
        description="导入已有 CPA/Codex auth JSON，系统按 workspace 保存凭证，不会创建 Web session。"
        submitLabel="导入凭证"
        confirmLoading={busy === 'import-credential'}
        onCancel={closeModal}
        onSubmit={importCredential}
      />

      <LocalProfileModal
        open={searchState.modal === 'edit-subaccount-profile' && Boolean(selected)}
        mode="subaccount"
        title="编辑子号本地资料"
        description="只更新本系统保存的备注名和 Web session，不修改 Codex 凭证。"
        initialValues={{ label: selected?.label ?? '' }}
        confirmLoading={busy === 'edit-subaccount-profile'}
        onCancel={closeModal}
        onSubmit={updateLocalProfile}
      />

      <Modal
        open={searchState.modal === 'register-subaccount'}
        title="自动注册子号"
        okText="开始注册"
        cancelText="取消"
        confirmLoading={busy === 'register-subaccount'}
        onCancel={closeModal}
        onOk={() => void registerSubaccount()}
      >
        系统会使用运行环境配置完成邮箱、短信和 Codex 授权流程。生成的密码只保存在后端运行时数据。
      </Modal>

      <Modal
        open={searchState.modal === 'delete-subaccount' && Boolean(selected)}
        title="删除子号"
        okText="删除子号"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: busy === 'delete-subaccount' }}
        onCancel={closeModal}
        onOk={() => void deleteSubaccount()}
      >
        仅从本系统移除 {selected?.label} 的本地记录，不会移除 ChatGPT Team 成员。
      </Modal>

      <Modal
        open={searchState.modal === 'invite-to-team' && Boolean(selected)}
        title="邀请子号加入 Team"
        okText="发送邀请"
        cancelText="取消"
        confirmLoading={busy === 'invite-to-team'}
        onCancel={closeModal}
        onOk={() => inviteForm.submit()}
        destroyOnClose
      >
        <Form<TeamInviteValues>
          form={inviteForm}
          layout="vertical"
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
      </Modal>

      <Modal
        open={searchState.modal === 'manual-codex-callback' && Boolean(authSession)}
        title={`手动授权回调${authSession?.targetLabel ? ` · ${authSession.targetLabel}` : ''}`}
        okText="提交回调并生成凭证"
        cancelText="取消"
        confirmLoading={busy === 'codex-callback'}
        onCancel={closeModal}
        onOk={() => void completeManualAuth()}
      >
        <Space direction="vertical" size={12} className="panel-stack">
          <Input.TextArea rows={4} value={authSession?.authUrl ?? ''} readOnly spellCheck={false} />
          <Input.TextArea
            rows={5}
            value={callbackUrl}
            spellCheck={false}
            placeholder="粘贴授权回调 URL"
            onChange={(event) => setCallbackUrl(event.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        open={searchState.modal === 'delete-codex-credential' && Boolean(selected)}
        title="删除 Codex 凭证"
        okText="删除凭证"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: busy === targetKey('credential-delete', searchState.target) }}
        onCancel={closeModal}
        onOk={() => void deleteCredential()}
      >
        确认删除 workspace {searchState.target || '当前'} 的 Codex 凭证？这不会移除 Team 成员关系。
      </Modal>

      <BillingRiskModal
        open={searchState.modal === 'billing-risk'}
        confirmLoading={busy === 'billing-risk'}
        onCancel={closeModal}
        onConfirm={() => void confirmBillingRisk()}
      />
    </div>
  );
}
