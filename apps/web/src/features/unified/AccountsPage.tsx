import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  type TableColumnsType,
} from "antd";
import { HolderOutlined, PlusOutlined } from "@ant-design/icons";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AccountGroupView,
  AccountRegistrationSummaryView,
  UnifiedAccountSummaryView,
} from "@team-manager/shared";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { unifiedApi } from "../../unifiedApi.js";
import {
  LoadBoundary,
  PageHeader,
  TriStateCheckboxFilter,
} from "../../components/ProductPrimitives.js";
import {
  accountListBooleanFilter,
  persistAccountListFilters,
  accountListRequestQuery,
  accountSelectionState,
  countAccountsByGroup,
  restorePersistedAccountListFilters,
  selectAccountsByGroup,
} from "./accountListModel.js";
import {
  AccountActionButtons,
  AccountActionModals,
} from "./AccountActions.js";
import {
  PRIMARY_PLAN_OPTIONS,
  accountRemarkLabel,
  lifecycleLabel,
  actionModalFromParams,
  primaryPlanLabel,
  seatUsageColor,
  setAccountActionInParams,
  type AccountActionModal,
  type AccountActionSummary,
} from "./accountActionsModel.js";
import { AccountOperationSummary, isActiveOperation } from "./AccountOperationSummary.js";
import { OperationDrawer } from "../../components/OperationDrawer.js";
import { useUrlPagination } from "../../components/urlPagination.js";

type AccountListRow = UnifiedAccountSummaryView | AccountRegistrationSummaryView;
function isRegistration(row: AccountListRow): row is AccountRegistrationSummaryView { return "kind" in row && row.kind === "registration"; }

const TRI_STATE_FILTERS = [
  ["hasGamBinding", "GAM"],
  ["hasRunningProfile", "Profile 运行"],
  ["isBanned", "封号"],
] as const;

export function AccountsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const committedQuery = params.get("query") ?? "";
  const [queryInput, setQueryInput] = useState(committedQuery);
  const [groups, setGroups] = useState<AccountGroupView[]>([]);
  const [matchingAccounts, setMatchingAccounts] = useState<
    UnifiedAccountSummaryView[]
  >([]);
  const [registrations, setRegistrations] = useState<AccountRegistrationSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [reorderingGroups, setReorderingGroups] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<"group" | "ban" | "unban">();
  const [error, setError] = useState("");
  const [batchGroupForm] = Form.useForm<{ groupId: string }>();
  const batchBusy = batchAction !== undefined;
  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const latestRequest = useRef(0);
  const restoredLocationKey = useRef<string>();
  const modal = params.get("modal");
  const accountAction = actionModalFromParams(params);
  const actionAccountId = params.get("actionAccountId");
  const selectedGroupId = params.get("groupId") ?? undefined;
  const accountRequestQuery = accountListRequestQuery(params);
  const accountRequestKey = accountRequestQuery.toString();

  const accounts = useMemo(
    () => selectAccountsByGroup(matchingAccounts, selectedGroupId),
    [matchingAccounts, selectedGroupId],
  );
  const rows = useMemo<AccountListRow[]>(() => {
    const pending = selectedGroupId ? registrations.filter((item) => item.group.id === selectedGroupId) : registrations;
    return [...pending, ...accounts];
  }, [accounts, registrations, selectedGroupId]);
  const pagination = useUrlPagination({ total: rows.length, pageSizeStorageKey: "accounts" });
  const groupCounts = useMemo(
    () => countAccountsByGroup([...matchingAccounts, ...registrations]),
    [matchingAccounts, registrations],
  );
  const filteredAccountIds = useMemo(
    () => accounts.map((account) => account.id),
    [accounts],
  );
  const filteredAccountIdSet = useMemo(
    () => new Set(filteredAccountIds),
    [filteredAccountIds],
  );
  const selectionState = useMemo(
    () => accountSelectionState(selectedAccountIds, filteredAccountIds),
    [filteredAccountIds, selectedAccountIds],
  );
  const actionAccount = useMemo(
    () =>
      matchingAccounts.find((account) => account.id === actionAccountId) as
        | AccountActionSummary
        | undefined,
    [actionAccountId, matchingAccounts],
  );

  const fetchAccounts = async (query: URLSearchParams) => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    try {
      const [nextGroups, nextAccounts, nextRegistrations] = await Promise.all([
        unifiedApi.groups(),
        unifiedApi.accounts(query),
        unifiedApi.accountRegistrations(query),
      ]);
      if (requestId === latestRequest.current) {
        setGroups(nextGroups);
        setMatchingAccounts(nextAccounts);
        setRegistrations(nextRegistrations);
      }
    } catch (cause) {
      if (requestId === latestRequest.current) {
        setError((cause as Error).message);
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  };

  const load = () => fetchAccounts(accountListRequestQuery(params));

  useEffect(() => {
    void fetchAccounts(new URLSearchParams(accountRequestKey));
  }, [accountRequestKey]);
  useEffect(() => {
    setQueryInput(committedQuery);
  }, [committedQuery]);
  useEffect(() => {
    const storage = browserStorage();
    const restored = restorePersistedAccountListFilters(params, storage);
    if (!restored) {
      persistAccountListFilters(params, storage);
      return;
    }
    if (restoredLocationKey.current === location.key) return;
    restoredLocationKey.current = location.key;
    setParams(restored, { replace: true });
  }, [location.key, params, setParams]);
  useEffect(() => {
    setSelectedAccountIds([]);
  }, [accountRequestKey, selectedGroupId]);
  useEffect(() => {
    setSelectedAccountIds((current) =>
      current.filter((accountId) => filteredAccountIdSet.has(accountId)),
    );
  }, [filteredAccountIdSet]);
  useEffect(() => {
    if (![...matchingAccounts.map((item) => item.latestOperation), ...registrations.map((item) => item.operation)].some(isActiveOperation)) return;
    const timer = window.setInterval(load, 5_000);
    return () => window.clearInterval(timer);
  }, [matchingAccounts, registrations, accountRequestKey]);

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    persistAccountListFilters(next, browserStorage());
    setParams(next);
  };
  const commitQuery = (value: string) => {
    const nextQuery = value.trim();
    setQueryInput(nextQuery);
    if (nextQuery === committedQuery) return;
    set("query", nextQuery || undefined);
  };
  const resetFilters = () => {
    setQueryInput("");
    const next = new URLSearchParams();
    persistAccountListFilters(next, browserStorage());
    setParams(next);
  };
  const toggleMultiSelect = () => {
    if (multiSelect) {
      setSelectedAccountIds([]);
      if (modal === "batch-group") set("modal");
    }
    setMultiSelect(!multiSelect);
  };
  const runBatchUpdate = async (
    patch: { groupId?: string; isBanned?: boolean },
    successMessage: string,
    action: "group" | "ban" | "unban",
  ) => {
    if (!selectedAccountIds.length || batchBusy) return;
    setBatchAction(action);
    try {
      const result = await unifiedApi.bulkUpdateAccounts({
        accountIds: selectedAccountIds,
        ...patch,
      });
      message.success(`${successMessage}，共 ${result.updatedCount} 个账号`);
      setSelectedAccountIds([]);
      if (modal === "batch-group") set("modal");
      void load();
    } catch (cause) {
      message.error(`批量操作失败：${(cause as Error).message}`);
    } finally {
      setBatchAction(undefined);
    }
  };
  const openAccountAction = (
    account: Pick<UnifiedAccountSummaryView, "id">,
    action: AccountActionModal,
  ) => setParams(setAccountActionInParams(params, action, account.id));
  const closeAccountAction = () =>
    setParams(setAccountActionInParams(params));

  const columns: TableColumnsType<AccountListRow> = [
    {
      title: "分组",
      dataIndex: ["group", "name"],
      fixed: "left",
      width: 100,
      ellipsis: true,
    },
    {
      title: "账号",
      fixed: "left",
      width: 260,
      render: (_, row) => (
        <div>
          <Space size={8}>
            {isRegistration(row) ? <Typography.Text strong>{row.email ?? "邮箱分配中"}</Typography.Text> : <Link to={`/accounts/${row.id}`} onClick={(event) => event.stopPropagation()}>
              <Typography.Text strong className="account-email-link">{row.email}</Typography.Text>
            </Link>}
            {!isRegistration(row) && row.isBanned && (
              <Badge status="error" text="封号" title="人工封号" />
            )}
            {!isRegistration(row) && row.accessHealth.status === "invalid" && <Badge status="error" text="登录无效" />}
            {!isRegistration(row) && row.lastError && <Badge status="error" text="同步失败" title={row.lastError} />}
            {!isRegistration(row) && ["failed", "interrupted"].includes(row.latestOperation?.status ?? "") && <Badge status="error" text="操作失败" />}
          </Space>
          <br />
          <Typography.Text type="secondary">{isRegistration(row) ? "注册中的临时账号" : accountRemarkLabel(row.remark)}</Typography.Text>
          {(isRegistration(row) ? row.operation : row.latestOperation) && <AccountOperationSummary operation={isRegistration(row) ? row.operation : row.latestOperation!} onOpen={(id) => set("operationId", id)} />}
        </div>
      ),
    },
    {
      title: "主套餐",
      dataIndex: "primaryPlan",
      width: 180,
      render: (_, row) => isRegistration(row) ? "—" : (
        <Tag
          className="primary-plan-tag"
          color={row.primaryPlan === "business_two_seat" && row.primaryPlanSeatUsage
            ? seatUsageColor(row.primaryPlanSeatUsage.occupied, row.primaryPlanSeatUsage.capacity)
            : row.primaryPlan === "free" ? "default" : "blue"}
        >
          {row.primaryPlan === "business_two_seat" && row.primaryPlanSeatUsage
            ? `双席位 ${row.primaryPlanSeatUsage.occupied}/${row.primaryPlanSeatUsage.capacity}`
            : primaryPlanLabel(row.primaryPlan)}
        </Tag>
      ),
    },
    { title: "续费/到期", width: 150, render: (_, row) => isRegistration(row) ? "—" : lifecycleLabel(row.primaryPlanLifecycle) },
    {
      title: "能力",
      width: 90,
      render: (_, row) => !isRegistration(row) && row.hasGamBinding && <Tag color="green">GAM</Tag>,
    },
    {
      title: "操作",
      fixed: "right",
      width: 270,
      render: (_, row) => isRegistration(row) ? <Button size="small" onClick={() => set("operationId", row.operation.id)}>查看进度</Button> : (
        <AccountActionButtons
          account={row as AccountActionSummary}
          onOpen={(action) => openAccountAction(row, action)}
          onChanged={load}
        />
      ),
    },
  ];

  const reorderGroups = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || reorderingGroups) return;
    const oldIndex = groups.findIndex((group) => group.id === active.id);
    const newIndex = groups.findIndex((group) => group.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previousGroups = groups;
    const nextGroups = arrayMove(groups, oldIndex, newIndex);
    setGroups(nextGroups);
    setReorderingGroups(true);
    try {
      setGroups(await unifiedApi.reorderGroups(nextGroups.map((group) => group.id)));
    } catch (cause) {
      setGroups(previousGroups);
      message.error(`分组排序失败：${(cause as Error).message}`);
    } finally {
      setReorderingGroups(false);
    }
  };

  return (
    <Card className="page-card">
      <Space direction="vertical" size={16} className="panel-stack">
        <PageHeader
          title="账号"
          description="账号运营与 Workspace 关系统一从账号进入"
          actions={
            <>
              <Button onClick={() => set("modal", "groups")}>管理分组</Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate("/accounts/new")}
              >
                添加账号
              </Button>
            </>
          }
        />

        <div className="account-group-filter">
          <Typography.Text strong>账号分组</Typography.Text>
          <Radio.Group
            className="group-selector account-group-selector"
            value={selectedGroupId ?? ""}
            onChange={(event) => set("groupId", event.target.value || undefined)}
            aria-label="账号分组筛选"
          >
            <Radio.Button value="">
              <span className="account-group-option">
                全部
                <span className="account-group-count">
                  {matchingAccounts.length + registrations.length}
                </span>
              </span>
            </Radio.Button>
            {groups.map((group) => (
              <Radio.Button key={group.id} value={group.id}>
                <span className="account-group-option">
                  {group.name}
                  <span className="account-group-count">
                    {groupCounts.get(group.id) ?? 0}
                  </span>
                </span>
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>

        <div className="filter-bar">
          <Input
            className="account-query-filter"
            placeholder="邮箱、备注、名称"
            allowClear
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            onPressEnter={(event) => commitQuery(event.currentTarget.value)}
            onBlur={(event) => commitQuery(event.currentTarget.value)}
          />
          <Select
            allowClear
            placeholder="主套餐"
            value={params.get("primaryPlan") ?? undefined}
            onChange={(value) => set("primaryPlan", value)}
            options={[...PRIMARY_PLAN_OPTIONS]}
          />
          {TRI_STATE_FILTERS.map(([key, label]) => (
            <TriStateCheckboxFilter
              key={key}
              label={label}
              value={accountListBooleanFilter(params, key)}
              onChange={(value) => set(key, value)}
            />
          ))}
          <Button type={multiSelect ? "primary" : "default"} onClick={toggleMultiSelect}>
            {multiSelect ? "退出多选" : "多选"}
          </Button>
          <Button loading={loading} onClick={load}>刷新</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>

        {multiSelect && (
          <div className="account-batch-toolbar">
            <Checkbox
              checked={selectionState.allSelected}
              indeterminate={selectionState.partiallySelected}
              disabled={!filteredAccountIds.length || batchBusy}
              onChange={(event) =>
                setSelectedAccountIds(event.target.checked ? filteredAccountIds : [])
              }
            >
              全选筛选结果（{filteredAccountIds.length}）
            </Checkbox>
            <Typography.Text>已选 {selectedAccountIds.length} 个</Typography.Text>
            <Button
              disabled={!selectedAccountIds.length || batchBusy}
              loading={batchAction === "group"}
              onClick={() => set("modal", "batch-group")}
            >
              更换分组
            </Button>
            <Button
              danger
              disabled={!selectedAccountIds.length || batchBusy}
              loading={batchAction === "ban"}
              onClick={() => void runBatchUpdate({ isBanned: true }, "已标记封号", "ban")}
            >
              标记封号
            </Button>
            <Button
              disabled={!selectedAccountIds.length || batchBusy}
              loading={batchAction === "unban"}
              onClick={() => void runBatchUpdate({ isBanned: false }, "已取消封号", "unban")}
            >
              取消封号
            </Button>
            <Button
              disabled={!selectedAccountIds.length || batchBusy}
              onClick={() => setSelectedAccountIds([])}
            >
              取消选择
            </Button>
          </div>
        )}

        <LoadBoundary
          loading={loading}
          error={error}
          empty={!rows.length}
          onRetry={load}
        >
          <Table<AccountListRow>
            rowKey="id"
            dataSource={rows}
            pagination={pagination}
            scroll={{ x: 1160 }}
            columns={columns}
            rowSelection={multiSelect ? {
              selectedRowKeys: selectedAccountIds,
              preserveSelectedRowKeys: true,
              hideSelectAll: true,
              getCheckboxProps: (row) => ({
                disabled: isRegistration(row),
                "aria-label": isRegistration(row)
                  ? "注册中的临时账号不可选择"
                  : `选择账号 ${row.email}`,
              }),
              onChange: (keys) => setSelectedAccountIds(
                keys.map(String).filter((id) => filteredAccountIdSet.has(id)),
              ),
            } : undefined}
          />
        </LoadBoundary>
      </Space>

      <Modal
        title="账号分组"
        open={modal === "groups"}
        onCancel={() => set("modal")}
        footer={null}
        width={700}
      >
        <Space direction="vertical" className="panel-stack">
          <DndContext
            sensors={groupSensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void reorderGroups(event)}
          >
            <SortableContext
              items={groups.map((group) => group.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="group-sortable-list">
                {groups.map((group) => (
                  <SortableGroupRow
                    key={group.id}
                    group={group}
                    disabled={reorderingGroups}
                    onRename={async (name) => setGroups(await unifiedApi.renameGroup(group.id, name))}
                    onDelete={async () => setGroups(await unifiedApi.deleteGroup(group.id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <Form
            layout="inline"
            onFinish={async (value) => {
              await unifiedApi.createGroup(value.name);
              await load();
            }}
          >
            <Form.Item name="name" rules={[{ required: true }]}>
              <Input placeholder="新分组名称" />
            </Form.Item>
            <Button htmlType="submit" type="primary">
              创建分组
            </Button>
          </Form>
        </Space>
      </Modal>
      <Modal
        title="批量更换分组"
        open={modal === "batch-group"}
        onCancel={() => set("modal")}
        footer={null}
        destroyOnHidden
        afterClose={() => batchGroupForm.resetFields()}
      >
        <Form
          form={batchGroupForm}
          layout="vertical"
          onFinish={({ groupId }) => void runBatchUpdate({ groupId }, "已更换分组", "group")}
        >
          <Typography.Paragraph type="secondary">
            将已选择的 {selectedAccountIds.length} 个账号移动到目标分组。
          </Typography.Paragraph>
          <Form.Item
            name="groupId"
            label="目标分组"
            rules={[{ required: true, message: "请选择目标分组" }]}
          >
            <Select
              placeholder="选择分组"
              options={groups.map((group) => ({
                label: `${group.name}（${group.accountCount}）`,
                value: group.id,
              }))}
            />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={batchAction === "group"}>
              更换分组
            </Button>
            <Button disabled={batchBusy} onClick={() => set("modal")}>
              取消
            </Button>
          </Space>
        </Form>
      </Modal>
      <AccountActionModals
        account={actionAccount}
        action={accountAction}
        onClose={closeAccountAction}
        onChanged={load}
        onOperationCreated={(operation) => {
          const next = setAccountActionInParams(params);
          next.set("operationId", operation.id);
          setParams(next);
          void load();
        }}
      />
      <OperationDrawer operationId={params.get("operationId") ?? undefined} open={Boolean(params.get("operationId"))} onClose={() => set("operationId")} onChanged={load} />
    </Card>
  );
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function SortableGroupRow({
  group,
  disabled,
  onRename,
  onDelete,
}: {
  group: AccountGroupView;
  disabled: boolean;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id, disabled });

  return (
    <div
      ref={setNodeRef}
      className={`group-sortable-item${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Form
        className="group-row"
        initialValues={{ name: group.name }}
        onFinish={(value) => onRename(value.name)}
      >
        <Space wrap>
          <Button
            ref={setActivatorNodeRef}
            type="text"
            className="group-drag-handle"
            icon={<HolderOutlined />}
            disabled={disabled}
            aria-label={`拖动 ${group.name} 调整排序`}
            title="拖动排序"
            {...attributes}
            {...listeners}
          />
          <Form.Item name="name" rules={[{ required: true }]} noStyle>
            <Input disabled={group.isDefault} />
          </Form.Item>
          <Button htmlType="submit" disabled={group.isDefault}>
            重命名
          </Button>
          <Button
            danger
            disabled={group.isDefault || group.accountCount > 0}
            onClick={() => void onDelete()}
          >
            删除
          </Button>
          <Typography.Text type="secondary">
            {group.accountCount} 个账号
          </Typography.Text>
        </Space>
      </Form>
    </div>
  );
}
