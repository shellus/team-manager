import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
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
} from "antd";
import { CopyOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useParams, useSearchParams } from "react-router-dom";
import type {
  BillingDetailView,
  AccountActivityView,
  OpenBusinessSubscriptionRequest,
  SeatSlotView,
  UnifiedAccountSummaryView,
  WorkspaceDetailView,
  SubscriptionDetailView,
} from "@team-manager/shared";
import { unifiedApi, type SeatSlotInput } from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";
import { ActivityTimeline, BillingSummary, SubscriptionSummary } from "../../components/OperationalDataPanels.js";
import { PaymentCardFields } from "../../components/PaymentCardFields.js";
import {
  editableMemberRoleOptions,
  roleLabel,
  seatLabel,
} from "../../labels.js";
import { OperationDrawer } from "../../components/OperationDrawer.js";
import type { AccountManagerOperationView } from "@team-manager/shared";
import {
  workspaceSettingsFormValues,
  workspaceSettingsPatch,
  type WorkspaceSettingsFormValues,
} from "./unifiedUiModels.js";
import { useRememberedForm } from "../../webPreferences.js";

export function WorkspaceDetailPage() {
  const { workspaceId } = useParams();
  const [params, setParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<WorkspaceDetailView>();
  const [accounts, setAccounts] = useState<UnifiedAccountSummaryView[]>([]);
  const [billing, setBilling] = useState<BillingDetailView>();
  const [subscription, setSubscription] = useState<SubscriptionDetailView>();
  const [activity, setActivity] = useState<AccountActivityView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [businessOperation, setBusinessOperation] =
    useState<AccountManagerOperationView>();
  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      const [w, a] = await Promise.all([
        unifiedApi.workspace(workspaceId),
        unifiedApi.accounts(new URLSearchParams("hasManageableWorkspace=true")),
      ]);
      setWorkspace(w);
      setAccounts(a);
      const extras = await Promise.allSettled([
        unifiedApi.workspaceBilling(workspaceId),
        unifiedApi.workspaceSubscription(workspaceId),
        unifiedApi.workspaceActivity(workspaceId),
      ]);
      if (extras[0].status === "fulfilled") setBilling(extras[0].value);
      if (extras[1].status === "fulfilled") setSubscription(extras[1].value);
      if (extras[2].status === "fulfilled") setActivity(extras[2].value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [workspaceId]);
  const executors = useMemo(
    () =>
      workspace?.members.filter(
        (m) => m.accountId && ["owner", "admin"].includes(m.role),
      ) ?? [],
    [workspace],
  );
  const tab = params.get("tab") ?? "overview";
  const modal = params.get("modal");
  const set = (k: string, v?: string) => {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    setParams(n);
  };
  const executorAccountId =
    params.get("executorAccountId") ?? executors[0]?.accountId ?? "";
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <LoadBoundary
      loading={loading && !workspace}
      error={!workspace ? error : undefined}
      onRetry={load}
    >
      {workspace && (
        <Space direction="vertical" size={16} className="panel-stack">
          {error && <Alert type="error" showIcon message={error} />}
          <Card>
            <PageHeader
              title={workspace.name ?? workspace.externalId}
              description={`Workspace · ${workspace.externalId}`}
              actions={
                <>
                  <Select
                    placeholder="执行账号"
                    value={executorAccountId || undefined}
                    onChange={(v) => set("executorAccountId", v)}
                    style={{ width: 240 }}
                    options={executors.map((m) => ({
                      value: m.accountId!,
                      label: m.accountEmail ?? m.email ?? m.accountId,
                    }))}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    disabled={!executorAccountId}
                    loading={busy === "refresh"}
                    onClick={() =>
                      run("refresh", () =>
                        unifiedApi.refreshWorkspace(
                          workspace.id,
                          executorAccountId,
                        ),
                      )
                    }
                  >
                    刷新全部
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => set("modal", "business")}
                  >
                    Business 套餐
                  </Button>
                </>
              }
            />
          </Card>
          <Card>
            <Tabs
              activeKey={tab}
              onChange={(v) => set("tab", v)}
              items={[
                {
                  key: "overview",
                  label: "概览",
                  children: (
                    <Space direction="vertical" className="panel-stack">
                      <Descriptions
                        bordered
                        column={{ xs: 1, sm: 2 }}
                        items={[
                          {
                            key: "id",
                            label: "外部 ID",
                            children: workspace.externalId,
                          },
                          {
                            key: "plan",
                            label: "套餐",
                            children: <Tag>{workspace.plan}</Tag>,
                          },
                          {
                            key: "manager",
                            label: "可管理账号",
                            children: workspace.manageableAccountCount,
                          },
                          {
                            key: "renew",
                            label: "下次续费",
                            children: formatTime(workspace.nextRenewalAt),
                          },
                        ]}
                      />
                      <Typography.Title level={4}>订阅</Typography.Title>
                      <SubscriptionSummary value={subscription} />
                      {workspace.consistencyRisks.length>0&&<Space direction="vertical" className="panel-stack">{workspace.consistencyRisks.map(risk=><Alert key={risk.key} type={risk.severity} showIcon message={risk.title} description={<Space direction="vertical"><span>{risk.detail}</span><Button size="small" onClick={()=>set("tab",risk.targetTab)}>前往处理</Button></Space>}/>)}</Space>}
                    </Space>
                  ),
                },
                {
                  key: "members",
                  label: `成员 (${workspace.members.length})`,
                  children: (
                    <Table
                      rowKey="id"
                      dataSource={workspace.members}
                      scroll={{ x: 1000 }}
                      columns={[
                        {
                          title: "成员",
                          render: (_, r) =>
                            r.email ?? r.accountEmail ?? r.remoteUserId,
                        },
                        { title: "角色", dataIndex: "role", render: roleLabel },
                        {
                          title: "席位",
                          dataIndex: "seatType",
                          render: seatLabel,
                        },
                        { title: "状态", dataIndex: "status" },
                        {
                          title: "操作",
                          fixed: "right",
                          render: (_, r) => (
                            <Space>
                              <Select
                                size="small"
                                value={r.role}
                                disabled={!r.remoteUserId || !executorAccountId}
                                onChange={(role) =>
                                  run(`role-${r.id}`, () =>
                                    unifiedApi.patchMember(
                                      workspace.id,
                                      r.remoteUserId!,
                                      { executorAccountId, role },
                                    ),
                                  )
                                }
                                options={editableMemberRoleOptions(
                                  r.rawRole ?? r.role,
                                )}
                              />
                              <Select
                                size="small"
                                value={r.seatType}
                                disabled={!r.remoteUserId || !executorAccountId}
                                onChange={(seat) =>
                                  run(`seat-${r.id}`, () =>
                                    unifiedApi.patchMember(
                                      workspace.id,
                                      r.remoteUserId!,
                                      { executorAccountId, seat },
                                    ),
                                  )
                                }
                                options={[
                                  { value: "default", label: "ChatGPT" },
                                  { value: "usage_based", label: "Codex" },
                                ]}
                              />
                              <Button
                                size="small"
                                danger
                                disabled={!r.remoteUserId || !executorAccountId}
                                onClick={() =>
                                  Modal.confirm({
                                    title: "移除成员？",
                                    content:
                                      "标准席位移除后仍可能临时计费，请先核对 Billing。",
                                    onOk: () =>
                                      run(`remove-${r.id}`, () =>
                                        unifiedApi.removeMember(
                                          workspace.id,
                                          r.remoteUserId!,
                                          executorAccountId,
                                        ),
                                      ),
                                  })
                                }
                              >
                                移除
                              </Button>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "invitations",
                  label: `邀请 (${workspace.invitations.length})`,
                  children: (
                    <Space direction="vertical" className="panel-stack">
                      <Form
                        layout="inline"
                        onFinish={(v) =>
                          run("invite", () =>
                            unifiedApi.invite(workspace.id, {
                              ...v,
                              executorAccountId,
                            }),
                          )
                        }
                      >
                        <Form.Item
                          name="email"
                          rules={[{ required: true, type: "email" }]}
                        >
                          <Input placeholder="邀请邮箱" />
                        </Form.Item>
                        <Form.Item name="role" initialValue="standard-user">
                          <Select
                            style={{ width: 150 }}
                            options={editableMemberRoleOptions("standard-user")}
                          />
                        </Form.Item>
                        <Form.Item name="seat" initialValue="usage_based">
                          <Select
                            style={{ width: 150 }}
                            options={[
                              { value: "usage_based", label: "Codex 席位" },
                              { value: "default", label: "ChatGPT 席位" },
                            ]}
                          />
                        </Form.Item>
                        <Button htmlType="submit" disabled={!executorAccountId}>
                          发送邀请
                        </Button>
                      </Form>
                      <Table
                        rowKey="id"
                        dataSource={workspace.invitations}
                        scroll={{ x: 800 }}
                        columns={[
                          { title: "邮箱", dataIndex: "email" },
                          {
                            title: "角色",
                            dataIndex: "role",
                            render: roleLabel,
                          },
                          {
                            title: "席位",
                            dataIndex: "seatType",
                            render: seatLabel,
                          },
                          { title: "状态", dataIndex: "status" },
                          {
                            title: "操作",
                            render: (_, r) => (
                              <Button
                                size="small"
                                danger
                                disabled={!executorAccountId}
                                onClick={() =>
                                  run(`revoke-${r.id}`, () =>
                                    unifiedApi.revokeInvitation(
                                      workspace.id,
                                      executorAccountId,
                                      r.email,
                                    ),
                                  )
                                }
                              >
                                撤销
                              </Button>
                            ),
                          },
                        ]}
                      />
                    </Space>
                  ),
                },
                {
                  key: "seats",
                  label: `客户席位 (${workspace.seatSlots.length})`,
                  children: (
                    <SeatSlots
                      workspace={workspace}
                      executorAccountId={executorAccountId}
                      busy={busy}
                      run={run}
                      modal={modal}
                      set={set}
                    />
                  ),
                },
                {
                  key: "credentials",
                  label: `凭证 (${workspace.credentials.length})`,
                  children: (
                    <Table<WorkspaceDetailView["credentials"][number]>
                      rowKey="id"
                      dataSource={workspace.credentials}
                      scroll={{ x: 900 }}
                      columns={[
                        { title: "账号", render:(_,row)=><Typography.Link href={`/accounts/${row.accountId}?tab=credentials`}>{row.accountEmail}</Typography.Link> },
                        { title: "类型", dataIndex: "kind" },
                        {
                          title: "号池",
                          render: (_, row) => row.poolGroup?.name ?? "—",
                        },
                        { title: "状态", dataIndex: "status" },
                        {
                          title: "额度",
                          render: (_, row) =>
                            row.latestQuota ? <Space direction="vertical" size={1}><Tag color={row.latestQuota.status==='success'?'green':row.latestQuota.status==='error'?'red':'default'}>{row.latestQuota.status==='success'?'正常':row.latestQuota.status==='error'?'错误':'不可用'}</Tag>{row.latestQuota.windows.map(window=><Typography.Text key={window.id} type="secondary">{window.label}：{window.usedPercent??'—'}% · 重置 {formatTime(window.resetAt??undefined)}</Typography.Text>)}<Typography.Text type="secondary">快照 {formatTime(row.quotaObservedAt)}</Typography.Text></Space> : "未刷新",
                        },
                        {
                          title:"操作",
                          fixed:"right",
                          render:(_,row)=><Space><Button size="small" onClick={()=>run(`quota-${row.id}`,()=>unifiedApi.refreshCredentialQuota(row.id))}>刷新额度</Button><Button size="small" href={`/accounts/${row.accountId}?tab=credentials`}>管理凭证</Button></Space>
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "settings",
                  label: "Workspace 设置",
                  children: (
                    <WorkspaceSettings
                      workspace={workspace}
                      executorAccountId={executorAccountId}
                      busy={busy}
                      run={run}
                    />
                  ),
                },
                {
                  key: "billing",
                  label: "账单",
                  children: (
                    <BillingPanel
                      workspaceId={workspace.id}
                      workspaceExternalId={workspace.externalId}
                      executorAccountId={executorAccountId}
                      value={billing}
                      busy={busy}
                      run={run}
                      reload={async()=>{const next=await unifiedApi.workspaceBilling(workspace.id);setBilling(next);}}
                    />
                  ),
                },
                {key:"activity",label:`活动日志 (${activity.length})`,children:<ActivityTimeline value={activity}/>},
              ]}
            />
          </Card>
          <BusinessModal
            open={modal === "business"}
            workspace={workspace}
            accounts={accounts}
            executors={executors}
            onClose={() => set("modal")}
            onCreated={(op) => {
              setBusinessOperation(op);
              const next = new URLSearchParams(params);
              next.delete("modal");
              next.set("operationId", op.id);
              setParams(next);
            }}
          />
          <OperationDrawer
            operation={businessOperation}
            operationId={params.get("operationId") ?? undefined}
            open={Boolean(params.get("operationId"))}
            onClose={() => {
              setBusinessOperation(undefined);
              const next = new URLSearchParams(params);
              next.delete("operationId");
              setParams(next);
            }}
            onChanged={load}
          />
        </Space>
      )}
    </LoadBoundary>
  );
}

function WorkspaceSettings({
  workspace,
  executorAccountId,
  busy,
  run,
}: {
  workspace: WorkspaceDetailView;
  executorAccountId: string;
  busy: string;
  run: (k: string, a: () => Promise<unknown>) => Promise<void>;
}) {
  const payload = workspace.latestSettings?.payload ?? {};
  const names: Array<
    [Exclude<keyof WorkspaceSettingsFormValues, "name" | "defaultSeat">, string]
  > = [
    ["workspaceReferralsEnabled", "推荐"],
    ["autoAcceptRequests", "自动接受邀请"],
    ["personalAccessTokensEnabled", "允许 PAT"],
    ["codexDeviceCodeAuthEnabled", "Device Code 登录"],
    ["codexRemoteControlEnabled", "远程控制"],
    ["automaticReloadEnabled", "Automatic reload"],
  ];
  const initialValues = workspaceSettingsFormValues(payload, workspace.name);
  return (
    <Space direction="vertical" className="panel-stack">
      <Form
        layout="vertical"
        key={workspace.latestSettings?.observedAt ?? workspace.updatedAt}
        initialValues={initialValues}
        onFinish={(v: WorkspaceSettingsFormValues) =>
          run("settings", async () => {
            if (typeof v.name === "string" && v.name !== workspace.name)
              await unifiedApi.renameWorkspace(
                workspace.id,
                executorAccountId,
                v.name,
              );
            const settings = workspaceSettingsPatch(v);
            if (Object.keys(settings).length) {
              await unifiedApi.patchWorkspaceSettings(workspace.id, {
                executorAccountId,
                ...settings,
              });
            }
          })
        }
      >
        <div className="responsive-form-grid">
          <Form.Item name="name" label="Workspace 名称">
            <Input />
          </Form.Item>
          <Form.Item name="defaultSeat" label="默认席位">
            <Select
              options={[
                { value: "usage_based", label: "Codex" },
                { value: "default", label: "ChatGPT" },
              ]}
            />
          </Form.Item>
        </div>
        <div className="switch-grid">
          {names.map(([name, label]) => (
            <Form.Item key={name} name={name} label={label}>
              <Select
                allowClear
                placeholder="未知（快照未提供）"
                options={[
                  { value: true, label: "明确开启" },
                  { value: false, label: "明确关闭" },
                ]}
              />
            </Form.Item>
          ))}
        </div>
        <Button
          type="primary"
          htmlType="submit"
          disabled={!executorAccountId}
          loading={busy === "settings"}
        >
          保存全部设置
        </Button>
      </Form>
    </Space>
  );
}

function BillingPanel({
  workspaceId,
  workspaceExternalId,
  executorAccountId,
  value,
  busy,
  run,
  reload,
}: {
  workspaceId: string;
  workspaceExternalId: string;
  executorAccountId: string;
  value?: BillingDetailView;
  busy: string;
  run:(key:string,action:()=>Promise<unknown>)=>Promise<void>;
  reload:()=>Promise<void>;
}) {
  return (
    <Space direction="vertical" className="panel-stack">
      <Space wrap>
        <Button href={`https://chatgpt.com/account/manage?account_id=${encodeURIComponent(workspaceExternalId)}`} target="_blank" rel="noreferrer">打开 ChatGPT 账单管理</Button>
        <Button icon={<ReloadOutlined/>} disabled={!executorAccountId} loading={busy==='billing'} onClick={()=>run('billing',async()=>{await unifiedApi.refreshWorkspaceBilling(workspaceId,executorAccountId);await reload();})}>刷新账单</Button>
      </Space>
      <BillingSummary value={value}/>
    </Space>
  );
}

function SeatSlots({
  workspace,
  executorAccountId,
  busy,
  run,
  modal,
  set,
}: {
  workspace: WorkspaceDetailView;
  executorAccountId: string;
  busy: string;
  run: (k: string, a: () => Promise<unknown>) => Promise<void>;
  modal: string | null;
  set: (k: string, v?: string) => void;
}) {
  const edit = workspace.seatSlots.find(
    (slot) => slot.id === new URLSearchParams(location.search).get("seatId"),
  );
  return (
    <Space direction="vertical" className="panel-stack">
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => set("modal", "seat")}
      >
        创建客户席位
      </Button>
      <Table
        rowKey="id"
        dataSource={workspace.seatSlots}
        scroll={{ x: 1200 }}
        columns={[
          { title: "邮箱", dataIndex: "email" },
          { title: "联系方式", dataIndex: "contact" },
          { title: "备注", dataIndex: "remark" },
          { title: "价格", dataIndex: "price" },
          { title: "到期", dataIndex: "expiresOn" },
          { title: "类型", dataIndex: "seatType", render: seatLabel },
          { title: "状态", dataIndex: "status" },
          {
            title: "操作",
            fixed: "right",
            render: (_, slot) => (
              <Space>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      `${location.origin}/seat/${slot.seatKey}`,
                    )
                  }
                >
                  复制公开链接
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    set("seatId", slot.id);
                    set("modal", "seat");
                  }}
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  disabled={!executorAccountId}
                  onClick={() =>
                    run(`release-${slot.id}`, () =>
                      unifiedApi.releaseSeatSlot(
                        workspace.id,
                        slot.id,
                        executorAccountId,
                      ),
                    )
                  }
                >
                  释放占用
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    Modal.confirm({
                      title: "管理员人工换号",
                      content: (
                        <Input id={`swap-${slot.id}`} placeholder="新邮箱" />
                      ),
                      onOk: () => {
                        const email = (
                          document.getElementById(
                            `swap-${slot.id}`,
                          ) as HTMLInputElement
                        ).value;
                        return run(`swap-${slot.id}`, () =>
                          unifiedApi.swapSeatSlot(
                            workspace.id,
                            slot.id,
                            executorAccountId,
                            email,
                          ),
                        );
                      },
                    })
                  }
                >
                  人工换号
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: "删除客户席位？",
                      onOk: () =>
                        run(`delete-${slot.id}`, () =>
                          unifiedApi.deleteSeatSlot(workspace.id, slot.id),
                        ),
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <SeatSlotModal
        open={modal === "seat"}
        initial={edit}
        onClose={() => {
          set("modal");
          set("seatId");
        }}
        onSubmit={(value) =>
          run("seat-save", () =>
            edit
              ? unifiedApi.updateSeatSlot(workspace.id, edit.id, value)
              : unifiedApi.createSeatSlot(workspace.id, value),
          )
        }
      />
    </Space>
  );
}

function SeatSlotModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: SeatSlotView;
  onClose: () => void;
  onSubmit: (v: SeatSlotInput) => Promise<void>;
}) {
  return (
    <Modal
      title={initial ? "编辑客户席位" : "创建客户席位"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        layout="vertical"
        initialValues={
          initial ?? {
            seatType: "usage_based",
            expireReminder: true,
            expireRemove: false,
            status: "empty",
          }
        }
        onFinish={async (v) => {
          await onSubmit(v);
          onClose();
        }}
      >
        <div className="responsive-form-grid">
          <Form.Item name="email" label="当前邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="contact" label="联系方式">
            <Input />
          </Form.Item>
          <Form.Item name="price" label="价格">
            <Input />
          </Form.Item>
          <Form.Item name="expiresOn" label="到期日">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="seatType" label="席位类型">
            <Select
              options={[
                { value: "usage_based", label: "Codex" },
                { value: "default", label: "ChatGPT" },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: "empty", label: "空置" },
                { value: "invited", label: "已邀请" },
                { value: "member", label: "已绑定" },
                { value: "unknown", label: "未知" },
                { value: "disabled", label: "停用" },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item name="remark" label="备注">
          <Input.TextArea />
        </Form.Item>
        <Space>
          <Form.Item name="expireReminder" label="到期提醒" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="expireRemove" label="到期移除" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit">
          保存客户席位
        </Button>
      </Form>
    </Modal>
  );
}

function BusinessModal({
  open,
  workspace,
  accounts,
  executors,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspace: WorkspaceDetailView;
  accounts: UnifiedAccountSummaryView[];
  executors: WorkspaceDetailView["members"];
  onClose: () => void;
  onCreated: (op: AccountManagerOperationView) => void;
}) {
  const [form] = Form.useForm();
  const remember = useRememberedForm(form, "business-subscription", [
    "mode",
    "accountId",
    "workspaceId",
    "country",
    "currency",
    "promoCode",
    "autoPay",
  ]);
  const mode = Form.useWatch("mode", form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Business 开通"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={640}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          mode: "upgrade_existing_workspace",
          workspaceId: workspace.id,
          country: "US",
          currency: "USD",
          autoPay: false,
        }}
        onFinish={async (
          v: OpenBusinessSubscriptionRequest & { accountId: string },
        ) => {
          remember(v);
          setBusy(true);
          setError("");
          try {
            onCreated(await unifiedApi.openBusiness(v.accountId, v));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item name="mode" label="开通方式">
          <Select
            options={[
              { value: "create_workspace", label: "创建新 Business Workspace" },
              {
                value: "upgrade_existing_workspace",
                label: "升级当前 Workspace",
              },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="accountId"
          label="执行账号"
          rules={[{ required: true }]}
        >
          <Select
            options={(mode === "create_workspace" ? accounts : executors).map(
              (m: any) => ({
                value: m.id ?? m.accountId,
                label: m.email ?? m.accountEmail ?? m.id,
              }),
            )}
          />
        </Form.Item>
        {mode === "upgrade_existing_workspace" && (
          <Form.Item name="workspaceId" hidden>
            <Input />
          </Form.Item>
        )}
        <div className="responsive-form-grid">
          <Form.Item name="country" label="国家">
            <Input maxLength={2} />
          </Form.Item>
          <Form.Item name="currency" label="货币">
            <Input maxLength={3} />
          </Form.Item>
        </div>
        <Form.Item name="promoCode" label="优惠码">
          <Input />
        </Form.Item>
        <Form.Item name="autoPay" label="自动提交付款" valuePropName="checked">
          <Switch />
        </Form.Item>
        <details>
          <summary>使用新支付卡（可选）</summary>
          <PaymentCardFields prefix="card" />
        </details>
        {error && <Alert type="error" showIcon message={error} />}
        <Button type="primary" htmlType="submit" loading={busy}>
          创建 Business 操作
        </Button>
      </Form>
    </Modal>
  );
}
