import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { ProductModal, useProductMessage, useProductModal } from "../../components/ProductOverlays.js";
import type {
  BillingDetailView,
  CredentialPoolGroupView,
  SubscriptionDetailView,
  UnifiedAccountDetailView,
  RemovedAccountWorkspaceView,
  WorkspaceDetailView,
  WorkspaceMemberRemovalResult,
  WorkspaceSettingMutationInput,
  SeatSlotView,
  WorkspaceInvitationMutationInput,
  EditableMemberRole,
  SeatType,
} from "@team-manager/shared";
import { unifiedApi, type SeatSlotInput } from "../../unifiedApi.js";
import { BillingSummary, SubscriptionSummary } from "../../components/OperationalDataPanels.js";
import { formatTime } from "../../components/ProductPrimitives.js";
import { WorkspaceCredentialActions } from "../../components/WorkspaceCredentialActions.js";
import { useUrlPagination } from "../../components/urlPagination.js";
import { editableMemberRoleOptions, roleLabel, seatLabel, statusLabel, SEAT_OPTIONS } from "../../labels.js";
import { SNAPSHOT_BOOLEAN_OPTIONS } from "../../components/selectOptions.js";
import { useRememberedForm } from "../../webPreferences.js";
import {
  automaticReloadDetails,
  INVITE_MEMBER_INITIAL_VALUES,
  workspaceSettingsFormValues,
} from "./unifiedUiModels.js";
import {
  accountWorkspacePeople,
  resolveAccountWorkspaceId,
  selectAccountWorkspaceParams,
  type AccountWorkspacePersonRow,
} from "./accountWorkspaceModel.js";
import { WorkspacePromotionModal } from "./WorkspacePromotionModal.js";
import { useSearchParams } from "react-router-dom";
import { SubscriptionPaymentMethodModal } from "../../components/SubscriptionPaymentMethodModal.js";
import { errorMessage } from "../../api.js";

export function AccountWorkspacePanel({
  account,
  poolGroups,
  onAccountChanged,
}: {
  account: UnifiedAccountDetailView;
  poolGroups: CredentialPoolGroupView[];
  onAccountChanged: () => Promise<void>;
}) {
  const productMessage = useProductMessage();
  const productModal = useProductModal();
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

  const load = async (options: { preserveError?: boolean } = {}) => {
    if (!workspaceId) return;
    setLoading(true);
    if (!options.preserveError) setError("");
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
      setError(errorMessage(reason, "Workspace 数据读取失败"));
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
      productMessage.success("操作已完成");
      await Promise.all([load(), onAccountChanged()]);
      return true;
    } catch (reason) {
      const message = errorMessage(reason, "Workspace 操作失败");
      await load({ preserveError: true });
      setError(message);
      productMessage.error(message);
      return false;
    } finally {
      setBusy("");
    }
  };

  const mutateWorkspace = async (
    key: string,
    action: () => Promise<WorkspaceDetailView>,
    accountChanged = false,
  ): Promise<boolean> => {
    setBusy(key);
    setError("");
    try {
      const next = await action();
      setWorkspace(next);
      if (accountChanged) await onAccountChanged();
      productMessage.success("操作已完成");
      return true;
    } catch (reason) {
      const message = errorMessage(reason, "Workspace 操作失败");
      setError(message);
      productMessage.error(message);
      return false;
    } finally {
      setBusy("");
    }
  };

  const syncAccountWorkspaces = async () => {
    setBusy("account-workspace-sync");
    setError("");
    try {
      const result = await unifiedApi.syncAccountWorkspaces(account.id);
      await onAccountChanged();
      productMessage.success(result.removedCount > 0
        ? `账号与 Workspace 关系已同步，${result.removedCount} 个关系已移除`
        : "账号与 Workspace 关系已同步");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const deleteLocalWorkspace = (item: RemovedAccountWorkspaceView) => {
    productModal.confirm({
      title: "彻底删除本地 Workspace 数据？",
      content: "将删除 Team Manager 保存的成员历史、邀请、凭证、客户席位、账单与订阅快照、订单和已结束操作历史。不会调用 ChatGPT 删除远端 Workspace。",
      okText: "删除本地数据",
      okButtonProps: { danger: true },
      onOk: async () => {
        const key = `delete-local-workspace-${item.id}`;
        setBusy(key);
        setError("");
        try {
          const result = await unifiedApi.deleteLocalWorkspace(item.id);
          await onAccountChanged();
          if (result.credentialArtifactCleanupFailures > 0) {
            productMessage.warning("Workspace 本地记录已删除，部分凭证文件将在制品清理任务中继续处理");
          } else {
            productMessage.success("Workspace 本地数据已彻底删除");
          }
        } catch (reason) {
          setError((reason as Error).message);
          throw reason;
        } finally {
          setBusy("");
        }
      },
    });
  };

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
  const removedWorkspaces = account.removedWorkspaces ?? [];
  const workspaceSwitcher = (
    <Space wrap>
      <Select
        aria-label="选择 Workspace"
        value={workspaceId}
        placeholder="暂无活动 Workspace"
        disabled={account.workspaces.length === 0}
        onChange={selectWorkspace}
        style={{ minWidth: 280 }}
        options={account.workspaces.map((item) => ({
          value: item.id,
          label: `${item.name ?? item.externalId} · ${roleLabel(item.role)}`,
        }))}
      />
      <Button
        icon={<ReloadOutlined />}
        loading={busy === "account-workspace-sync"}
        disabled={Boolean(busy) && busy !== "account-workspace-sync"}
        onClick={() => void syncAccountWorkspaces()}
      >
        同步账号与 Workspace 关系
      </Button>
      {relationship && <Tag color={canManage ? "green" : "default"}>{roleLabel(relationship.role)}</Tag>}
      {relationship && !canManage && <Typography.Text type="secondary">普通成员只能查看空间资料并管理自己的凭证</Typography.Text>}
    </Space>
  );
  const removedWorkspaceSection = removedWorkspaces.length > 0 ? (
    <Space direction="vertical" size={8} className="panel-stack">
      <Typography.Title level={5}>已退出的 Workspace</Typography.Title>
      <Table<RemovedAccountWorkspaceView>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={removedWorkspaces}
        columns={[
          {
            title: "Workspace",
            render: (_, item) => <TwoLineCell primary={item.name ?? item.externalId} secondary={item.externalId} />,
          },
          {
            title: "关系移除时间",
            dataIndex: "removedAt",
            render: formatTime,
          },
          {
            title: "操作",
            width: 190,
            render: (_, item) => item.canDeleteLocally
              ? <Button
                  size="small"
                  danger
                  loading={busy === `delete-local-workspace-${item.id}`}
                  disabled={Boolean(busy) && busy !== `delete-local-workspace-${item.id}`}
                  onClick={() => deleteLocalWorkspace(item)}
                >
                  删除本地数据
                </Button>
              : <Typography.Text type="secondary">其他账号仍在使用</Typography.Text>,
          },
        ]}
      />
    </Space>
  ) : null;

  if (account.workspaces.length === 0) {
    return (
      <Space direction="vertical" size={16} className="panel-stack">
        {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}
        {workspaceSwitcher}
        {removedWorkspaceSection}
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该账号没有活动 Workspace 关系" />
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}
      {workspaceSwitcher}
      {removedWorkspaceSection}
      <Tabs
        activeKey={workspaceTab}
        onChange={setWorkspaceTab}
        items={[
          {
            key: "members",
            label: `成员 (${accountWorkspacePeople(workspace).length})`,
            children: <PeoplePanel workspace={workspace} accountId={account.id} canManage={canManage} loading={loading} busy={busy} lastRemoval={lastRemoval} setLastRemoval={setLastRemoval} run={run} mutateWorkspace={mutateWorkspace} modal={params.get("modal")} personId={params.get("personId")} setParams={setPanelParams} />,
          },
          {
            key: "billing",
            label: "账单",
            children: <BillingPanel workspace={workspace} accountId={account.id} canManage={canManage} value={billing} subscription={subscription} busy={busy} run={run} reload={load} modal={params.get("modal")} setParams={setPanelParams} />,
          },
          {
            key: "settings",
            label: "设置",
            children: workspace ? <WorkspaceSettings workspace={workspace} accountId={account.id} canManage={canManage} busy={busy} run={run} mutateWorkspace={mutateWorkspace} /> : <LoadingEmpty loading={loading} />,
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
  mutateWorkspace,
  modal,
  personId,
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
  mutateWorkspace: (key: string, action: () => Promise<WorkspaceDetailView>, accountChanged?: boolean) => Promise<boolean>;
  modal: string | null;
  personId: string | null;
  setParams: (values: Record<string, string | undefined>) => void;
}) {
  const rows = useMemo(() => accountWorkspacePeople(workspace), [workspace]);
  if (!workspace) return <LoadingEmpty loading={loading} />;
  const selectedPerson = rows.find((row) => row.rowKey === personId);
  const selectedSeatSlot = selectedPerson?.seatSlot;
  const refresh = () => run("people-refresh", () => unifiedApi.refreshWorkspacePeople(workspace.id, accountId));
  const closeModal = () => setParams({ modal: undefined, personId: undefined });
  const updateMemberRole = (row: AccountWorkspacePersonRow, role: EditableMemberRole) =>
    mutateWorkspace(`role-${row.id}`, () => unifiedApi.updateMemberRole(workspace.id, row.remoteUserId!, accountId, role), true);
  const updateSeat = async (row: AccountWorkspacePersonRow, seat: SeatType) => {
    if (row.kind === "member") {
      return mutateWorkspace(`seat-${row.id}`, () => unifiedApi.updateMemberSeat(workspace.id, row.remoteUserId!, accountId, seat), true);
    }
    return run(`seat-${row.id}`, () => unifiedApi.updateSeatSlot(workspace.id, row.seatSlot!.id, accountId, { seatType: seat }));
  };
  return (
    <Space direction="vertical" className="panel-stack">
      <Space wrap className="member-list-toolbar">
        <Typography.Text type="secondary">最后刷新：{formatTime(latestTime(rows.map((row) => row.observedAt).filter((value): value is string => Boolean(value))))}</Typography.Text>
        <Button icon={<ReloadOutlined />} disabled={!canManage} loading={busy === "people-refresh"} onClick={() => void refresh()}>刷新成员</Button>
        <Button type="primary" disabled={!canManage} onClick={() => setParams({ modal: "invite", personId: undefined })}>邀请成员</Button>
      </Space>
      {!canManage && <Alert type="info" showIcon message="当前账号不是 Workspace 所有者或管理员，空间级操作已禁用。" />}
      {lastRemoval && <Alert type={lastRemoval.hasBillingNotice ? "warning" : "info"} showIcon message={`最近移除成员：${lastRemoval.email ?? lastRemoval.remoteUserId}`} description={removalSummaryText(lastRemoval)} />}
      <Table<AccountWorkspacePersonRow>
        rowKey="rowKey"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1060 }}
        columns={[
          { title: "成员", width: 270, render: (_, row) => <TwoLineCell primary={personAccount(row)} secondary={row.seatSlot?.remark} /> },
          { title: "关系", width: 110, render: (_, row) => <Tag color={relationColor(row.kind)}>{relationLabel(row.kind)}</Tag> },
          { title: "角色", width: 140, render: (_, row) => row.kind === "member" && row.remoteUserId && canManage
            ? <Select aria-label={`修改 ${personAccount(row)} 的角色`} value={(row.rawRole ?? roleForSelect(row.role) ?? "standard-user") as EditableMemberRole} options={editableMemberRoleOptions(row.rawRole ?? row.role ?? "standard-user")} loading={busy === `role-${row.id}`} disabled={Boolean(busy)} onChange={(role: EditableMemberRole) => void updateMemberRole(row, role)} className="workspace-inline-select" />
            : row.role ? <Tag>{roleLabel(row.role)}</Tag> : <Typography.Text type="secondary">—</Typography.Text> },
          { title: "席位", width: 140, render: (_, row) => canManage && canEditSeat(row)
            ? <Select aria-label={`修改 ${personAccount(row)} 的席位`} value={row.seatType} options={SEAT_OPTIONS} loading={busy === `seat-${row.id}`} disabled={Boolean(busy)} onChange={(seat: SeatType) => void updateSeat(row, seat)} className="workspace-inline-select" />
            : <Tag>{seatLabel(row.seatType)}</Tag> },
          { title: "租客信息", width: 280, render: (_, row) => isWorkspaceOwner(row) ? null : <TwoLineCell primary={tenantPrimary(row.seatSlot)} secondary={<Space size={8}><span>{tenantExpiry(row.seatSlot)}</span>{canManage && (row.email || row.seatSlot) && <Button type="link" size="small" onClick={() => setParams({ modal: "tenant", personId: row.rowKey })}>编辑租客</Button>}</Space>} /> },
          {
            title: "操作",
            fixed: "right",
            width: 120,
            render: (_, row) => isWorkspaceOwner(row) ? null : <RelationAction row={row} canManage={canManage} workspaceId={workspace.id} accountId={accountId} run={run} setLastRemoval={setLastRemoval} />,
          },
        ]}
      />
      <TenantDataModal
        open={modal === "tenant" && Boolean(selectedPerson) && !isWorkspaceOwner(selectedPerson)}
        workspaceId={workspace.id}
        initial={selectedSeatSlot}
        person={selectedPerson}
        busy={busy === "tenant"}
        onClose={closeModal}
        onSubmit={(value) => run("tenant", () => selectedSeatSlot ? unifiedApi.updateSeatSlot(workspace.id, selectedSeatSlot.id, accountId, value) : unifiedApi.createSeatSlot(workspace.id, accountId, value))}
      />
      <InviteMemberModal open={modal === "invite"} busy={busy === "invite"} onClose={closeModal} onSubmit={(value) => run("invite", () => unifiedApi.invite(workspace.id, { ...value, executorAccountId: accountId }))} />
    </Space>
  );
}

type TenantDataValues = Pick<SeatSlotInput, "contact" | "remark" | "price" | "expiresOn" | "expireRemove">;
type InviteMemberValues = WorkspaceInvitationMutationInput;

function TenantDataModal({ open, workspaceId, initial, person, busy, onClose, onSubmit }: {
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
  return <ProductModal title={initial ? "编辑租客信息" : "添加租客信息"} open={open} onCancel={onClose}>
    <Form key={`${workspaceId}:${initial?.id ?? person?.rowKey ?? "new"}`} layout="vertical" initialValues={{ contact: initial?.contact, remark: initial?.remark, price: initial?.price, expiresOn: initial?.expiresOn, expireRemove: initial?.expireRemove ?? false }} onFinish={async (value:TenantDataValues) => { if (await onSubmit({ ...tenantDataInput(value), email, seatType })) onClose(); }} disabled={busy}>
      <Descriptions size="small" bordered column={1} items={[{ key: "email", label: "关联邮箱", children: email ?? "—" }]} />
      <TenantDataFields />
      <Button type="primary" htmlType="submit" loading={busy}>保存租客信息</Button>
    </Form>
  </ProductModal>;
}

function TenantDataFields() {
  return <>
    <div className="responsive-form-grid">
      <Form.Item name="contact" label="联系方式"><Input /></Form.Item>
      <Form.Item name="price" label="价格"><Input /></Form.Item>
      <Form.Item name="expiresOn" label="到期日" extra="设置到期日后自动参与到期提醒；清空后不提醒。"><Input type="date" /></Form.Item>
    </div>
    <Form.Item name="remark" label="备注"><Input.TextArea rows={3} /></Form.Item>
    <Form.Item name="expireRemove" label="到期后自动移除远端关系" valuePropName="checked" extra="关闭时，到期后只停用本地租客资料。"><Switch /></Form.Item>
  </>;
}

function InviteMemberModal({open,busy,onClose,onSubmit}:{open:boolean;busy:boolean;onClose:()=>void;onSubmit:(value:InviteMemberValues)=>Promise<boolean>}) {
  return <ProductModal title="邀请成员" open={open} onCancel={onClose}>
    <Form layout="vertical" initialValues={INVITE_MEMBER_INITIAL_VALUES} onFinish={async(value:InviteMemberValues)=>{if(await onSubmit({...value,...inviteTenantDataInput(value)}))onClose();}} disabled={busy}>
      <Form.Item name="email" label="账号邮箱" rules={[{required:true,type:"email",message:"请输入有效邮箱"}]}><Input /></Form.Item>
      <div className="responsive-form-grid">
        <Form.Item name="role" label="角色"><Select options={editableMemberRoleOptions("standard-user")} /></Form.Item>
        <Form.Item name="seat" label="席位"><Select options={SEAT_OPTIONS} /></Form.Item>
      </div>
      <Typography.Title level={5}>租客信息</Typography.Title>
      <TenantDataFields />
      <Button type="primary" htmlType="submit" loading={busy}>发送邀请</Button>
    </Form>
  </ProductModal>;
}

function TwoLineCell({primary,secondary}:{primary:ReactNode;secondary:ReactNode}) {
  const hasSecondary = secondary !== undefined && secondary !== null && secondary !== "" && secondary !== false;
  return <div className="table-main-cell workspace-person-cell"><div className="workspace-person-line">{primary}</div>{hasSecondary && <div className="workspace-person-line secondary">{secondary}</div>}</div>;
}

function RelationAction({row,canManage,workspaceId,accountId,run,setLastRemoval}:{
  row:AccountWorkspacePersonRow;
  canManage:boolean;
  workspaceId:string;
  accountId:string;
  run:(key:string,action:()=>Promise<unknown>)=>Promise<boolean>;
  setLastRemoval:(value:WorkspaceMemberRemovalResult["summary"])=>void;
}) {
  const productModal = useProductModal();
  if(isWorkspaceOwner(row))return null;
  if(!canManage)return <Typography.Text type="secondary">—</Typography.Text>;
  if(row.seatSlot?.status==="empty")return <Button size="small" danger onClick={()=>productModal.confirm({title:"删除异常租客资料？",content:"该资料没有关联邮箱，删除后无法恢复。",okText:"删除资料",onOk:()=>run(`delete-seat-${row.seatSlot!.id}`,()=>unifiedApi.deleteSeatSlot(workspaceId,row.seatSlot!.id,accountId))})}>删除资料</Button>;
  if(row.seatSlot){const copy=relationReleaseCopy(row);return <Button size="small" danger={row.kind==="member"} className={row.kind==="member"?undefined:"warning-action-button"} onClick={()=>productModal.confirm({...copy,onOk:()=>run(`release-${row.seatSlot!.id}`,()=>unifiedApi.releaseSeatSlot(workspaceId,row.seatSlot!.id,accountId))})}>{copy.okText}</Button>;}
  if(row.kind==="invitation")return <Button size="small" className="warning-action-button" onClick={()=>productModal.confirm({title:"撤销邀请？",content:`${row.email??"该账号"} 将无法接受当前邀请。`,okText:"撤销",onOk:()=>run(`revoke-${row.id}`,()=>unifiedApi.revokeInvitation(workspaceId,accountId,row.email!))})}>撤销</Button>;
  if(row.kind==="member"&&row.remoteUserId)return <Button size="small" danger onClick={()=>productModal.confirm({title:"移除成员？",content:"成员会立即失去 Workspace 访问权限；ChatGPT 固定席位仍可能临时计费，完成后请核对账单。",okText:"移除成员",onOk:()=>run(`remove-${row.id}`,async()=>{const result=await unifiedApi.removeMember(workspaceId,row.remoteUserId!,accountId);setLastRemoval(result.summary);})})}>移除成员</Button>;
  return <Typography.Text type="secondary">—</Typography.Text>;
}

export function relationReleaseCopy(row: Pick<AccountWorkspacePersonRow, "kind">) {
  if (row.kind === "member") return {
    title: "移除成员？",
    content: "成员会立即失去 Workspace 访问权限，关联的租客资料也会一并删除。完成后请核对账单。",
    okText: "移除成员",
  };
  if (row.kind === "invitation") return {
    title: "撤销邀请？",
    content: "邀请会被撤销，关联的租客资料也会一并删除。",
    okText: "撤销邀请",
  };
  return {
    title: "删除租客资料？",
    content: "失效的邮箱关联及其租客资料会一并删除。",
    okText: "删除资料",
  };
}

function tenantDataInput(value: TenantDataValues): TenantDataValues {
  return {
    contact: optionalText(value.contact), remark: optionalText(value.remark), price: optionalText(value.price),
    expiresOn: optionalText(value.expiresOn), expireRemove: value.expireRemove === true
  };
}
function inviteTenantDataInput(value: TenantDataValues): TenantDataValues {
  const contact = optionalText(value.contact), remark = optionalText(value.remark);
  const price = optionalText(value.price), expiresOn = optionalText(value.expiresOn);
  return {
    ...(contact ? { contact } : {}), ...(remark ? { remark } : {}), ...(price ? { price } : {}),
    ...(expiresOn ? { expiresOn } : {}), expireRemove: value.expireRemove === true
  };
}
function optionalText(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function personAccount(row: AccountWorkspacePersonRow) { return row.email ?? row.accountEmail ?? row.remoteUserId ?? "异常资料：缺少关联邮箱"; }
function relationLabel(kind: AccountWorkspacePersonRow["kind"]) { return kind === "member" ? "成员" : kind === "invitation" ? "邀请中" : "未关联"; }
function relationColor(kind: AccountWorkspacePersonRow["kind"]) { return kind === "member" ? "green" : kind === "invitation" ? "blue" : "default"; }
function isWorkspaceOwner(row?: AccountWorkspacePersonRow) { return row?.role === "owner"; }
function canEditSeat(row: AccountWorkspacePersonRow) { return (row.kind === "member" && Boolean(row.remoteUserId)) || (row.kind === "customer" && Boolean(row.seatSlot)); }
function roleForSelect(role?: string) { return role === "analytics_viewer" ? "analytics-viewer" : role === "member" ? "standard-user" : role === "admin" ? "account-admin" : role === "owner" ? "account-owner" : role; }
function tenantPrimary(slot?: SeatSlotView): ReactNode { return <Space size={8}><span>{slot?.contact ? `联系 ${slot.contact}` : "无联系方式"}</span>{slot?.price && <Tag>价格 {slot.price}</Tag>}</Space>; }
function tenantExpiry(slot?: SeatSlotView) { return slot?.expiresOn ? `到期 ${slot.expiresOn} · ${slot.expireRemove ? "到期移除" : "到期停用"}` : "未设置到期日"; }

function BillingPanel({ workspace, accountId, canManage, value, subscription, busy, run, reload, modal, setParams }: {
  workspace?: WorkspaceDetailView;
  accountId: string;
  canManage: boolean;
  value?: BillingDetailView;
  subscription?: SubscriptionDetailView;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
  reload: () => Promise<void>;
  modal: string | null;
  setParams: (values: Record<string, string | undefined>) => void;
}) {
  const productModal = useProductModal();
  if (!workspace) return <LoadingEmpty loading />;
  const paidSubscription = Boolean(subscription && !["free", "unknown"].includes(subscription.plan));
  const renewalCancelled = subscription?.willRenew === false;
  const renewalEnd = subscription?.endsAt ? formatTime(subscription.endsAt) : "当前计费周期结束";
  return <Space direction="vertical" size={16} className="panel-stack">
    <Space wrap>
      <Button href={`https://chatgpt.com/account/manage?account_id=${encodeURIComponent(workspace.externalId)}`} target="_blank" rel="noreferrer">打开 ChatGPT 账单管理</Button>
      <Button icon={<ReloadOutlined />} disabled={!canManage} loading={busy === "billing"} onClick={() => void run("billing", async () => { await unifiedApi.refreshWorkspaceBilling(workspace.id, accountId); await reload(); })}>刷新账单</Button>
      {paidSubscription && <Button
        danger={!renewalCancelled}
        disabled={!canManage || renewalCancelled}
        loading={busy === "workspace-cancel-renewal"}
        onClick={() => productModal.confirm({
          title: "取消 Workspace 自动续费？",
          content: `仅关闭自动续费，不退款；Workspace 权益保留到 ${renewalEnd}。`,
          okText: "取消 Workspace 续费",
          okButtonProps: { danger: true },
          cancelText: "返回",
          onOk: () => run("workspace-cancel-renewal", () => unifiedApi.cancelWorkspaceRenewal(workspace.id, accountId)),
        })}
      >
        {renewalCancelled ? "已取消续费" : "取消续费"}
      </Button>}
      <Button disabled={!canManage} onClick={() => setParams({ modal: "workspace-payment" })}>绑定支付方式</Button>
      <Button type="primary" disabled={!canManage} onClick={() => setParams({ modal: "workspace-promotion" })}>更新优惠码</Button>
    </Space>
    <Typography.Title level={5}>订阅与续费</Typography.Title>
    <SubscriptionSummary value={subscription} />
    <Typography.Title level={5}>账单</Typography.Title>
    <BillingSummary value={value} paymentMethodActions={{
      disabled: !canManage,
      onSetDefault: (paymentMethodId) => unifiedApi.setWorkspaceDefaultPaymentMethod(workspace.id, accountId, paymentMethodId),
      onRemove: (paymentMethodId) => unifiedApi.removeWorkspacePaymentMethod(workspace.id, accountId, paymentMethodId),
    }} />
    <WorkspacePromotionModal
      workspaceId={workspace.id}
      accountId={accountId}
      open={modal === "workspace-promotion"}
      onClose={() => setParams({ modal: undefined })}
      onApplied={async () => { await reload(); }}
    />
    <SubscriptionPaymentMethodModal
      targetLabel="当前 Workspace"
      open={modal === "workspace-payment"}
      busy={busy === "workspace-payment"}
      loadDefaults={() => unifiedApi.paymentMethodDefaults(accountId)}
      onClose={() => setParams({ modal: undefined })}
      onSubmit={async (value) => {
        await run("workspace-payment", async () => {
          await unifiedApi.addWorkspacePaymentMethod(workspace.id, accountId, value);
          setParams({ modal: undefined });
        });
      }}
    />
  </Space>;
}

function WorkspaceSettings({ workspace, accountId, canManage, busy, run, mutateWorkspace }: {
  workspace: WorkspaceDetailView;
  accountId: string;
  canManage: boolean;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
  mutateWorkspace: (key: string, action: () => Promise<WorkspaceDetailView>, accountChanged?: boolean) => Promise<boolean>;
}) {
  const productModal = useProductModal();
  const payload = workspace.latestSettings?.payload ?? {};
  const initialValues = workspaceSettingsFormValues(payload, workspace.name);
  const reloadDetails = automaticReloadDetails(payload);
  const [nameForm] = Form.useForm<{ name: string }>();
  const booleanSettings: Array<[Exclude<WorkspaceSettingMutationInput["key"], "defaultSeat">, string]> = [
    ["workspaceReferralsEnabled", "推荐"], ["autoAcceptRequests", "自动接受邀请"], ["personalAccessTokensEnabled", "允许 PAT"], ["codexDeviceCodeAuthEnabled", "Device Code 登录"], ["codexRemoteControlEnabled", "远程控制"], ["automaticReloadEnabled", "Automatic reload"],
  ];
  useEffect(() => { nameForm.setFieldsValue({ name: workspace.name ?? "" }); }, [nameForm, workspace.id, workspace.name]);
  const saveName = async ({ name }: { name: string }) => {
    const value = name.trim();
    if (value === workspace.name) return;
    const saved = await mutateWorkspace("workspace-name", () => unifiedApi.renameWorkspace(workspace.id, accountId, value), true);
    if (!saved) nameForm.setFieldsValue({ name: workspace.name ?? "" });
  };
  const saveSetting = (input: WorkspaceSettingMutationInput) => {
    const execute = () => mutateWorkspace(`workspace-setting-${input.key}`, () => unifiedApi.updateWorkspaceSetting(workspace.id, accountId, input));
    if (input.key === "automaticReloadEnabled" && initialValues.automaticReloadEnabled !== true && input.value === true) {
      productModal.confirm({ title: "开启 Automatic reload？", content: "余额低于远端阈值时可能立即使用默认支付方式补款。", okText: "开启自动补款", onOk: execute });
      return;
    }
    void execute();
  };
  const controlsDisabled = !canManage || Boolean(busy);
  return <Space direction="vertical" className="panel-stack">
    <Space wrap><Typography.Text type="secondary">设置快照：{formatTime(workspace.latestSettings?.observedAt)}</Typography.Text><Button icon={<ReloadOutlined />} disabled={!canManage} loading={busy === "settings-refresh"} onClick={() => void run("settings-refresh", () => unifiedApi.refreshWorkspaceSettings(workspace.id, accountId))}>刷新设置</Button></Space>
    <Form form={nameForm} layout="vertical" onFinish={saveName} disabled={controlsDisabled} className="workspace-name-form">
      <Form.Item label="Workspace 名称">
        <Space.Compact block>
          <Form.Item name="name" noStyle rules={[{ required: true, whitespace: true, message: "请输入 Workspace 名称" }]}><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy === "workspace-name"}>保存名称</Button>
        </Space.Compact>
      </Form.Item>
    </Form>
    <Form layout="vertical" disabled={controlsDisabled}>
      <div className="responsive-form-grid">
        <Form.Item label="默认席位">
          <Select value={initialValues.defaultSeat} placeholder="未知（快照未提供）" options={SEAT_OPTIONS} loading={busy === "workspace-setting-defaultSeat"} onChange={(value: SeatType) => saveSetting({ key: "defaultSeat", value })} />
        </Form.Item>
        {booleanSettings.map(([key, label]) => <Form.Item key={key} label={label}>
          <Select value={initialValues[key]} placeholder="未知（快照未提供）" options={SNAPSHOT_BOOLEAN_OPTIONS} loading={busy === `workspace-setting-${key}`} onChange={(value: boolean) => saveSetting({ key, value })} />
        </Form.Item>)}
      </div>
    </Form>
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: "local", label: "Codex Local 权限", children: initialValues.codexLocalAccessEnabled === undefined ? "快照未提供" : initialValues.codexLocalAccessEnabled ? "允许" : "关闭" },
      { key: "threshold", label: "自动补款阈值", children: reloadDetails.threshold ?? "快照未提供" },
      { key: "target", label: "自动补款目标", children: reloadDetails.target ?? "快照未提供" },
      { key: "monthly", label: "月度补款", children: reloadDetails.monthlyLimit ? `限额 ${reloadDetails.monthlyLimit} · 剩余 ${reloadDetails.monthlyRemaining ?? "未知"}` : "快照未提供" },
    ]} />
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
  const pagination = useUrlPagination({ total: workspace.credentials.length, pageKey: "credentialsPage", pageSizeStorageKey: "workspace-credentials" });
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
    <ProductModal title="完成 OAuth 授权" open={Boolean(oauth)} onCancel={() => setOauth(undefined)}>
      <Alert type="info" showIcon message="在新窗口完成授权，再粘贴完整回调 URL。" />
      <Typography.Paragraph copyable={{ text: oauth?.authUrl }}>{oauth?.authUrl}</Typography.Paragraph>
      <Input.TextArea rows={4} value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="完整 OAuth callback URL" />
      <Button type="primary" disabled={!callback.trim()} onClick={() => oauth && run("oauth-complete", () => unifiedApi.completeOauthCredential(oauth.sessionId, callback, oauth.poolGroup)).then(() => setOauth(undefined))}>完成 OAuth 凭证</Button>
    </ProductModal>
  </Space>;
}

function latestTime(values: string[]): string | undefined { return values.length ? [...values].sort().at(-1) : undefined; }
function removalSummaryText(value: WorkspaceMemberRemovalResult["summary"]): string {
  return [value.upstreamSuccess === false ? "上游报告失败" : "成员已从远端移除", value.hasBillingNotice ? "请立即核对账单" : undefined, value.policy?.billedSeatDelta !== undefined ? `计费席位变化：${value.policy.billedSeatDelta}` : undefined].filter(Boolean).join("；");
}
