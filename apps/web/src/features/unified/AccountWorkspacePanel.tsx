import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type {
  BillingDetailView,
  CredentialPoolGroupView,
  SubscriptionDetailView,
  UnifiedAccountDetailView,
  WorkspaceDetailView,
  WorkspaceMemberRemovalResult,
  SeatSlotView,
} from "@team-manager/shared";
import { unifiedApi, type SeatSlotInput } from "../../unifiedApi.js";
import { BillingSummary, SubscriptionSummary } from "../../components/OperationalDataPanels.js";
import { formatTime } from "../../components/ProductPrimitives.js";
import { WorkspaceCredentialActions } from "../../components/WorkspaceCredentialActions.js";
import { useUrlPagination } from "../../components/urlPagination.js";
import { editableMemberRoleOptions, roleLabel, seatLabel, statusLabel } from "../../labels.js";
import { useRememberedForm } from "../../webPreferences.js";
import {
  automaticReloadDetails,
  workspaceSettingsFormValues,
  workspaceSettingsPatch,
  type WorkspaceSettingsFormValues,
} from "./unifiedUiModels.js";
import {
  accountWorkspacePeople,
  resolveAccountWorkspaceId,
  selectAccountWorkspaceParams,
  type AccountWorkspacePersonRow,
} from "./accountWorkspaceModel.js";
import { useSearchParams } from "react-router-dom";

export function AccountWorkspacePanel({
  account,
  poolGroups,
  onAccountChanged,
}: {
  account: UnifiedAccountDetailView;
  poolGroups: CredentialPoolGroupView[];
  onAccountChanged: () => Promise<void>;
}) {
  const [params, setParams] = useSearchParams();
  const workspaceId = resolveAccountWorkspaceId(account.workspaces, params.get("workspaceId"));
  const relationship = account.workspaces.find((item) => item.id === workspaceId);
  const [workspace, setWorkspace] = useState<WorkspaceDetailView>();
  const [billing, setBilling] = useState<BillingDetailView>();
  const [subscription, setSubscription] = useState<SubscriptionDetailView>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lastRemoval, setLastRemoval] = useState<WorkspaceMemberRemovalResult["summary"]>();

  useEffect(() => {
    if (!workspaceId || params.get("workspaceId") === workspaceId) return;
    setParams(selectAccountWorkspaceParams(params, workspaceId), { replace: true });
  }, [params, setParams, workspaceId]);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [detail, nextBilling, nextSubscription] = await Promise.all([
        unifiedApi.accountWorkspace(account.id, workspaceId),
        unifiedApi.workspaceBilling(workspaceId),
        unifiedApi.workspaceSubscription(workspaceId),
      ]);
      setWorkspace(detail);
      setBilling(nextBilling);
      setSubscription(nextSubscription);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setWorkspace(undefined);
    setBilling(undefined);
    setSubscription(undefined);
    void load();
  }, [account.id, workspaceId]);

  const run = async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key);
    setError("");
    try {
      await action();
      message.success("操作已完成");
      await Promise.all([load(), onAccountChanged()]);
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      await load();
      return false;
    } finally {
      setBusy("");
    }
  };

  if (account.workspaces.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该账号没有活动 Workspace 关系" />;
  }

  const requestedWorkspaceTab = params.get("workspaceTab");
  const workspaceTab = ["members", "billing", "settings", "credentials"].includes(requestedWorkspaceTab ?? "")
    ? requestedWorkspaceTab!
    : "members";
  const setWorkspaceTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("workspaceTab", value);
    setParams(next);
  };
  const selectWorkspace = (value: string) =>
    setParams(selectAccountWorkspaceParams(params, value));
  const setPanelParams = (values: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  const canManage = relationship?.manageable === true;

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}
      <Space wrap>
        <Select
          aria-label="选择 Workspace"
          value={workspaceId}
          onChange={selectWorkspace}
          style={{ minWidth: 280 }}
          options={account.workspaces.map((item) => ({
            value: item.id,
            label: `${item.name ?? item.externalId} · ${roleLabel(item.role)}`,
          }))}
        />
        {relationship && <Tag color={canManage ? "green" : "default"}>{roleLabel(relationship.role)}</Tag>}
        {!canManage && <Typography.Text type="secondary">普通成员只能查看空间资料并管理自己的凭证</Typography.Text>}
      </Space>
      <Tabs
        activeKey={workspaceTab}
        onChange={setWorkspaceTab}
        items={[
          {
            key: "members",
            label: `成员 (${accountWorkspacePeople(workspace).length})`,
            children: <PeoplePanel workspace={workspace} accountId={account.id} canManage={canManage} loading={loading} busy={busy} lastRemoval={lastRemoval} setLastRemoval={setLastRemoval} run={run} modal={params.get("modal")} seatSlotId={params.get("seatSlotId")} setParams={setPanelParams} />,
          },
          {
            key: "billing",
            label: "账单",
            children: <BillingPanel workspace={workspace} accountId={account.id} canManage={canManage} value={billing} subscription={subscription} busy={busy} run={run} reload={load} />,
          },
          {
            key: "settings",
            label: "设置",
            children: workspace ? <WorkspaceSettings workspace={workspace} accountId={account.id} canManage={canManage} busy={busy} run={run} /> : <LoadingEmpty loading={loading} />,
          },
          {
            key: "credentials",
            label: `凭证 (${workspace?.credentials.length ?? 0})`,
            children: workspace ? <CredentialsPanel accountId={account.id} workspace={workspace} poolGroups={poolGroups} busy={busy} run={run} /> : <LoadingEmpty loading={loading} />,
          },
        ]}
      />
    </Space>
  );
}

function LoadingEmpty({ loading }: { loading: boolean }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? "正在读取…" : "暂无资料"} />;
}

function PeoplePanel({
  workspace,
  accountId,
  canManage,
  loading,
  busy,
  lastRemoval,
  setLastRemoval,
  run,
  modal,
  seatSlotId,
  setParams,
}: {
  workspace?: WorkspaceDetailView;
  accountId: string;
  canManage: boolean;
  loading: boolean;
  busy: string;
  lastRemoval?: WorkspaceMemberRemovalResult["summary"];
  setLastRemoval: (value: WorkspaceMemberRemovalResult["summary"]) => void;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
  modal: string | null;
  seatSlotId: string | null;
  setParams: (values: Record<string, string | undefined>) => void;
}) {
  const rows = useMemo(() => accountWorkspacePeople(workspace), [workspace]);
  const pagination = useUrlPagination({ total: rows.length, pageKey: "peoplePage", pageSizeKey: "peoplePageSize" });
  if (!workspace) return <LoadingEmpty loading={loading} />;
  const selectedSeatSlot = workspace.seatSlots.find((slot) => slot.id === seatSlotId);
  const selectedPerson = rows.find((row) => row.rowKey === seatSlotId || row.seatSlot?.id === seatSlotId);
  const refresh = () => run("people-refresh", () => unifiedApi.refreshWorkspacePeople(workspace.id, accountId));
  return (
    <Space direction="vertical" className="panel-stack">
      <Space wrap>
        <Typography.Text type="secondary">关系快照：{formatTime(latestTime(rows.map((row) => row.observedAt).filter((value): value is string => Boolean(value))))}</Typography.Text>
        <Button icon={<ReloadOutlined />} disabled={!canManage} loading={busy === "people-refresh"} onClick={() => void refresh()}>刷新成员与邀请</Button>
      </Space>
      {!canManage && <Alert type="info" showIcon message="当前账号不是 Workspace 所有者或管理员，空间级操作已禁用。" />}
      {lastRemoval && <Alert type={lastRemoval.hasBillingNotice ? "warning" : "info"} showIcon message={`最近移除成员：${lastRemoval.email ?? lastRemoval.remoteUserId}`} description={removalSummaryText(lastRemoval)} />}
      <InviteForm disabled={!canManage} busy={busy === "invite"} onFinish={(value) => run("invite", () => unifiedApi.invite(workspace.id, { ...value, executorAccountId: accountId }))} />
      <Table<AccountWorkspacePersonRow>
        rowKey="rowKey"
        dataSource={rows}
        pagination={pagination}
        scroll={{ x: 1450 }}
        columns={[
          { title: "成员 / 邀请", render: (_, row) => <div>{row.email ?? (row.kind === "member" ? row.accountEmail ?? row.remoteUserId : "—")}<br/><Typography.Text type="secondary">{row.kind === "member" ? row.displayName ?? row.remoteUserId : row.kind === "invitation" ? "等待接受邀请" : "仅保留客户资料"}</Typography.Text></div> },
          { title: "关系", render: (_, row) => <Tag color={row.kind === "member" ? "green" : row.kind === "invitation" ? "blue" : "default"}>{row.kind === "member" ? "成员" : row.kind === "invitation" ? "邀请中" : "未关联资料"}</Tag> },
          { title: "角色", dataIndex: "role", render: (value) => value ? roleLabel(value) : "—" },
          { title: "席位", dataIndex: "seatType", render: seatLabel },
          { title: "联系方式", render: (_, row) => row.seatSlot?.contact ?? "—" },
          { title: "备注", render: (_, row) => row.seatSlot?.remark ?? "—" },
          { title: "价格", render: (_, row) => row.seatSlot?.price ?? "—" },
          { title: "到期", render: (_, row) => row.seatSlot?.expiresOn ? <Space direction="vertical" size={1}><span>{row.seatSlot.expiresOn}</span><Typography.Text type="secondary">到期提醒 · {row.seatSlot.expireRemove ? "到期后移除远端关系" : "到期后停用资料"}</Typography.Text></Space> : "—" },
          { title: "快照时间", dataIndex: "observedAt", render: formatTime },
          {
            title: "操作",
            fixed: "right",
            render: (_, row) => <Space wrap>
              <Button size="small" disabled={!canManage || (!row.email && !row.seatSlot)} onClick={() => setParams({ seatSlotId: row.seatSlot?.id ?? row.rowKey, modal: "customer-data" })}>{row.seatSlot ? "编辑资料" : "添加资料"}</Button>
              {row.seatSlot && row.seatSlot.status !== "empty" && <Button size="small" disabled={!canManage} onClick={() => Modal.confirm({ title: "释放客户资料占用？", content: ["member", "invited"].includes(row.seatSlot!.status) ? "会移除对应成员或撤销邀请，并保留联系方式、备注、价格和到期设置。" : "会清空失效的邮箱关联，并保留联系方式、备注、价格和到期设置。", okText: "释放占用", onOk: () => run(`release-${row.seatSlot!.id}`, () => unifiedApi.releaseSeatSlot(workspace.id, row.seatSlot!.id, accountId)) })}>释放占用</Button>}
              {row.seatSlot?.status === "empty" && <Button size="small" danger disabled={!canManage} onClick={() => Modal.confirm({ title: "删除空置客户资料？", content: "联系方式、备注、价格和到期设置会被删除。", okText: "删除资料", onOk: () => run(`delete-seat-${row.seatSlot!.id}`, () => unifiedApi.deleteSeatSlot(workspace.id, row.seatSlot!.id, accountId)) })}>删除资料</Button>}
              {row.kind === "invitation" ? (
                <Button size="small" danger disabled={!canManage} onClick={() => void run(`revoke-${row.id}`, () => unifiedApi.revokeInvitation(workspace.id, accountId, row.email!))}>撤销邀请</Button>
              ) : row.kind === "member" ? (
              <Space wrap>
                <Select size="small" value={row.role} disabled={!canManage || !row.remoteUserId} onChange={(role) => void run(`role-${row.id}`, () => unifiedApi.patchMember(workspace.id, row.remoteUserId!, { executorAccountId: accountId, role }))} options={editableMemberRoleOptions(row.rawRole ?? row.role!)} />
                <Select size="small" value={row.seatType} disabled={!canManage || !row.remoteUserId} onChange={(seat) => void run(`seat-${row.id}`, () => unifiedApi.patchMember(workspace.id, row.remoteUserId!, { executorAccountId: accountId, seat }))} options={[{ value: "default", label: "ChatGPT" }, { value: "usage_based", label: "Codex" }]} />
                <Button size="small" danger disabled={!canManage || !row.remoteUserId} onClick={() => Modal.confirm({ title: "移除成员？", content: "成员会立即失去 Workspace 访问权限；ChatGPT 固定席位仍可能临时计费，完成后请核对账单。", onOk: () => run(`remove-${row.id}`, async () => { const result = await unifiedApi.removeMember(workspace.id, row.remoteUserId!, accountId); setLastRemoval(result.summary); }) })}>移除</Button>
              </Space>
              ) : null}
            </Space>,
          },
        ]}
      />
      <CustomerDataModal
        open={modal === "customer-data"}
        workspaceId={workspace.id}
        initial={selectedSeatSlot}
        person={selectedPerson}
        busy={busy === "customer-data"}
        onClose={() => setParams({ modal: undefined, seatSlotId: undefined })}
        onSubmit={(value) => run("customer-data", () => selectedSeatSlot ? unifiedApi.updateSeatSlot(workspace.id, selectedSeatSlot.id, accountId, value) : unifiedApi.createSeatSlot(workspace.id, accountId, value))}
      />
    </Space>
  );
}

function CustomerDataModal({ open, workspaceId, initial, person, busy, onClose, onSubmit }: {
  open: boolean;
  workspaceId: string;
  initial?: SeatSlotView;
  person?: AccountWorkspacePersonRow;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: SeatSlotInput) => Promise<boolean>;
}) {
  const email = initial?.email ?? person?.email ?? person?.accountEmail;
  const seatType = initial?.seatType ?? person?.seatType ?? "usage_based";
  const hasRemoteRelation = person?.kind === "member" || person?.kind === "invitation";
  return <Modal title={initial ? "编辑客户资料" : "添加客户资料"} open={open} onCancel={onClose} footer={null} destroyOnHidden>
    <Form key={`${workspaceId}:${initial?.id ?? person?.rowKey ?? "new"}`} layout="vertical" initialValues={{ email, contact: initial?.contact, remark: initial?.remark, price: initial?.price, expiresOn: initial?.expiresOn, expireRemove: initial?.expireRemove ?? false, seatType }} onFinish={async (value) => { if (await onSubmit(value)) onClose(); }} disabled={busy}>
      <Descriptions size="small" bordered column={1} items={[{ key: "email", label: "关联邮箱", children: email ?? "—" }]} />
      <div className="responsive-form-grid">
        <Form.Item name="contact" label="联系方式"><Input /></Form.Item>
        <Form.Item name="price" label="价格"><Input /></Form.Item>
        <Form.Item name="expiresOn" label="到期日" extra="设置到期日后自动参与到期提醒；清空后不提醒。"><Input type="date" /></Form.Item>
        {hasRemoteRelation ? <Form.Item label="席位类型"><Input value={seatLabel(seatType)} disabled /></Form.Item> : <Form.Item name="seatType" label="席位类型"><Select options={[{ value: "usage_based", label: "Codex" }, { value: "default", label: "ChatGPT" }]} /></Form.Item>}
      </div>
      <Form.Item name="remark" label="备注"><Input.TextArea rows={3} /></Form.Item>
      <Form.Item name="expireRemove" label="到期后自动移除远端关系" valuePropName="checked" extra="关闭时，到期后只停用本地客户资料。"><Switch /></Form.Item>
      <Form.Item name="email" hidden><Input /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>保存客户资料</Button>
    </Form>
  </Modal>;
}

function InviteForm({ disabled, busy, onFinish }: { disabled: boolean; busy: boolean; onFinish: (value: Record<string, unknown>) => Promise<boolean> }) {
  return <Form layout="inline" onFinish={onFinish} initialValues={{ role: "standard-user", seat: "usage_based" }}>
    <Form.Item name="email" rules={[{ required: true, type: "email" }]}><Input placeholder="邀请邮箱" /></Form.Item>
    <Form.Item name="role"><Select style={{ width: 150 }} options={editableMemberRoleOptions("standard-user")} /></Form.Item>
    <Form.Item name="seat"><Select style={{ width: 150 }} options={[{ value: "usage_based", label: "Codex 席位" }, { value: "default", label: "ChatGPT 席位" }]} /></Form.Item>
    <Button htmlType="submit" disabled={disabled} loading={busy}>发送邀请</Button>
  </Form>;
}

function BillingPanel({ workspace, accountId, canManage, value, subscription, busy, run, reload }: {
  workspace?: WorkspaceDetailView;
  accountId: string;
  canManage: boolean;
  value?: BillingDetailView;
  subscription?: SubscriptionDetailView;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  if (!workspace) return <LoadingEmpty loading />;
  return <Space direction="vertical" size={16} className="panel-stack">
    <Space wrap>
      <Button href={`https://chatgpt.com/account/manage?account_id=${encodeURIComponent(workspace.externalId)}`} target="_blank" rel="noreferrer">打开 ChatGPT 账单管理</Button>
      <Button icon={<ReloadOutlined />} disabled={!canManage} loading={busy === "billing"} onClick={() => void run("billing", async () => { await unifiedApi.refreshWorkspaceBilling(workspace.id, accountId); await reload(); })}>刷新账单</Button>
    </Space>
    <Typography.Title level={5}>订阅与续费</Typography.Title>
    <SubscriptionSummary value={subscription} />
    <Typography.Title level={5}>账单</Typography.Title>
    <BillingSummary value={value} />
  </Space>;
}

function WorkspaceSettings({ workspace, accountId, canManage, busy, run }: {
  workspace: WorkspaceDetailView;
  accountId: string;
  canManage: boolean;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const payload = workspace.latestSettings?.payload ?? {};
  const initialValues = workspaceSettingsFormValues(payload, workspace.name);
  const reloadDetails = automaticReloadDetails(payload);
  const [form] = Form.useForm<WorkspaceSettingsFormValues>();
  const switches: Array<[Exclude<keyof WorkspaceSettingsFormValues, "name" | "defaultSeat" | "codexLocalAccessEnabled">, string]> = [
    ["workspaceReferralsEnabled", "推荐"], ["autoAcceptRequests", "自动接受邀请"], ["personalAccessTokensEnabled", "允许 PAT"], ["codexDeviceCodeAuthEnabled", "Device Code 登录"], ["codexRemoteControlEnabled", "远程控制"], ["automaticReloadEnabled", "Automatic reload"],
  ];
  const submit = (values: WorkspaceSettingsFormValues) => {
    const settings = workspaceSettingsPatch(values, initialValues);
    const execute = () => run("settings", async () => {
      if (values.name !== undefined && values.name !== workspace.name) await unifiedApi.renameWorkspace(workspace.id, accountId, values.name);
      if (Object.keys(settings).length) await unifiedApi.patchWorkspaceSettings(workspace.id, { executorAccountId: accountId, ...settings });
    });
    if (initialValues.automaticReloadEnabled !== true && settings.automaticReloadEnabled === true) {
      Modal.confirm({ title: "开启 Automatic reload？", content: "余额低于远端阈值时可能立即使用默认支付方式补款。", okText: "开启自动补款", onOk: execute });
      return;
    }
    void execute();
  };
  return <Space direction="vertical" className="panel-stack">
    <Space wrap><Typography.Text type="secondary">设置快照：{formatTime(workspace.latestSettings?.observedAt)}</Typography.Text><Button icon={<ReloadOutlined />} disabled={!canManage} loading={busy === "settings-refresh"} onClick={() => void run("settings-refresh", () => unifiedApi.refreshWorkspaceSettings(workspace.id, accountId))}>刷新设置</Button></Space>
    <Form form={form} key={workspace.latestSettings?.observedAt ?? workspace.updatedAt} layout="vertical" initialValues={initialValues} onFinish={submit} disabled={!canManage}>
      <div className="responsive-form-grid"><Form.Item name="name" label="Workspace 名称"><Input /></Form.Item><Form.Item name="defaultSeat" label="默认席位"><Select options={[{ value: "usage_based", label: "Codex" }, { value: "default", label: "ChatGPT" }]} /></Form.Item></div>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
        { key: "local", label: "Codex Local 权限", children: initialValues.codexLocalAccessEnabled === undefined ? "快照未提供" : initialValues.codexLocalAccessEnabled ? "允许" : "关闭" },
        { key: "threshold", label: "自动补款阈值", children: reloadDetails.threshold ?? "快照未提供" },
        { key: "target", label: "自动补款目标", children: reloadDetails.target ?? "快照未提供" },
        { key: "monthly", label: "月度补款", children: reloadDetails.monthlyLimit ? `限额 ${reloadDetails.monthlyLimit} · 剩余 ${reloadDetails.monthlyRemaining ?? "未知"}` : "快照未提供" },
      ]} />
      <div className="switch-grid">{switches.map(([name, label]) => <Form.Item key={name} name={name} label={label}><Select allowClear placeholder="未知（快照未提供）" options={[{ value: true, label: "明确开启" }, { value: false, label: "明确关闭" }]} /></Form.Item>)}</div>
      <Button type="primary" htmlType="submit" loading={busy === "settings"}>保存全部设置</Button>
    </Form>
  </Space>;
}

function CredentialsPanel({ accountId, workspace, poolGroups, busy, run }: {
  accountId: string;
  workspace: WorkspaceDetailView;
  poolGroups: CredentialPoolGroupView[];
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [form] = Form.useForm();
  const remember = useRememberedForm(form, "create-workspace-credential", ["kind", "poolGroup", "name"]);
  const [oauth, setOauth] = useState<{ sessionId: string; authUrl: string; poolGroup?: string }>();
  const [callback, setCallback] = useState("");
  const [error, setError] = useState("");
  const pagination = useUrlPagination({ total: workspace.credentials.length, pageKey: "credentialsPage", pageSizeKey: "credentialsPageSize" });
  const create = async (values: Record<string, string>) => {
    remember(values);
    if (values.kind === "pat") return run("pat", () => unifiedApi.createPatCredential(accountId, workspace.id, { name: values.name, poolGroupId: values.poolGroup }));
    setError("");
    try {
      const auth = await unifiedApi.createOauthCredential(accountId, workspace.id);
      setCallback("");
      setOauth({ ...auth, poolGroup: values.poolGroup });
      window.open(auth.authUrl, "_blank", "noopener,noreferrer");
    } catch (reason) { setError((reason as Error).message); }
  };
  return <Space direction="vertical" className="panel-stack">
    {error && <Alert type="error" showIcon message={error} />}
    <Form form={form} layout="inline" initialValues={{ kind: "pat" }} onFinish={create}>
      <Form.Item name="kind" label="类型"><Select style={{ width: 110 }} options={[{ value: "pat", label: "PAT" }, { value: "oauth", label: "OAuth" }]} /></Form.Item>
      <Form.Item name="poolGroup" label="号池组"><Select allowClear style={{ width: 180 }} options={poolGroups.map((group) => ({ value: group.id, label: group.name }))} /></Form.Item>
      <Form.Item name="name" label="名称"><Input /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy === "pat" || busy === "oauth"}>创建凭证</Button>
    </Form>
    <Table rowKey="id" dataSource={workspace.credentials} pagination={pagination} scroll={{ x: 950 }} columns={[
      { title: "类型", dataIndex: "kind" }, { title: "号池组", render: (_, row) => row.poolGroup?.name ?? "—" }, { title: "状态", dataIndex: "status", render: statusLabel },
      { title: "额度", render: (_, row) => row.latestQuota ? <Space direction="vertical" size={1}><Tag color={row.latestQuota.status === "success" ? "green" : "red"}>{statusLabel(row.latestQuota.status)}</Tag>{row.latestQuota.windows.map((window) => <Typography.Text key={window.id} type="secondary">{window.label}：{window.usedPercent ?? "—"}% · 重置 {formatTime(window.resetAt)}</Typography.Text>)}</Space> : "未刷新" },
      { title: "操作", fixed: "right", render: (_, row) => <WorkspaceCredentialActions credential={row} run={run} /> },
    ]} />
    <Modal title="完成 OAuth 授权" open={Boolean(oauth)} onCancel={() => setOauth(undefined)} footer={null} destroyOnHidden>
      <Alert type="info" showIcon message="在新窗口完成授权，再粘贴完整回调 URL。" />
      <Typography.Paragraph copyable={{ text: oauth?.authUrl }}>{oauth?.authUrl}</Typography.Paragraph>
      <Input.TextArea rows={4} value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="完整 OAuth callback URL" />
      <Button type="primary" disabled={!callback.trim()} onClick={() => oauth && run("oauth-complete", () => unifiedApi.completeOauthCredential(oauth.sessionId, callback, oauth.poolGroup)).then(() => setOauth(undefined))}>完成 OAuth 凭证</Button>
    </Modal>
  </Space>;
}

function latestTime(values: string[]): string | undefined { return values.length ? [...values].sort().at(-1) : undefined; }
function removalSummaryText(value: WorkspaceMemberRemovalResult["summary"]): string {
  return [value.upstreamSuccess === false ? "上游报告失败" : "成员已从远端移除", value.hasBillingNotice ? "请立即核对账单" : undefined, value.policy?.billedSeatDelta !== undefined ? `计费席位变化：${value.policy.billedSeatDelta}` : undefined].filter(Boolean).join("；");
}
