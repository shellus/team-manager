import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import type {
  UnifiedAccountSummaryView,
  WorkspaceSummaryView,
} from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import {
  JsonViewer,
  LoadBoundary,
  PageHeader,
  formatTime,
} from "../../components/ProductPrimitives.js";

interface TeamOrderData {
  configuration: Array<Record<string, unknown>>;
  maintenances: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
}
export function TeamOrdersPage() {
  const [data, setData] = useState<TeamOrderData>({
    configuration: [],
    maintenances: [],
    orders: [],
  });
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryView[]>([]);
  const [accounts, setAccounts] = useState<UnifiedAccountSummaryView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [next, nextWorkspaces, nextAccounts] = await Promise.all([
        unifiedApi.teamOrders(),
        unifiedApi.workspaces(),
        unifiedApi.accounts(new URLSearchParams("hasManageableWorkspace=true")),
      ]);
      setData(next as unknown as TeamOrderData);
      setWorkspaces(nextWorkspaces);
      setAccounts(nextAccounts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
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
    <Space direction="vertical" size={16} className="panel-stack">
      <Card>
        <PageHeader
          title="Team 升级订单"
          description="订单属于 Workspace，执行账号只是当前策略选择"
          actions={
            <>
              <Button
                loading={busy === "all"}
                onClick={() =>
                  run("all", () =>
                    unifiedApi.runTeamOrders({
                      all: true,
                      source: "manual_all",
                    }),
                  )
                }
              >
                为全部 Workspace 生成订单
              </Button>
              <Button
                type="primary"
                loading={busy === "due"}
                onClick={() =>
                  run("due", () =>
                    unifiedApi.runTeamOrders({ source: "manual_maintenance" }),
                  )
                }
              >
                运行维护池
              </Button>
            </>
          }
        />
      </Card>
      {error && <Alert type="error" showIcon message={error} />}
      <LoadBoundary loading={loading} error={error} onRetry={load}>
        <Card title="全局配置">
          <Form
            layout="inline"
            initialValues={
              data.configuration.find((item) => !item.workspace_id) ?? {
                country: "US",
                currency: "USD",
              }
            }
            onFinish={(value) =>
              run("config", () => unifiedApi.saveTeamOrderConfiguration(value))
            }
          >
            <Form.Item name="promoCode" label="优惠码">
              <Input />
            </Form.Item>
            <Form.Item name="country" label="国家">
              <Input maxLength={2} />
            </Form.Item>
            <Form.Item name="currency" label="货币">
              <Input maxLength={3} />
            </Form.Item>
            <Button
              htmlType="submit"
              type="primary"
              loading={busy === "config"}
            >
              保存配置
            </Button>
          </Form>
        </Card>
        <Card title="加入维护池">
          <Form
            layout="inline"
            onFinish={(value) =>
              run("maintenance", () =>
                unifiedApi.saveTeamOrderMaintenance(value.workspaceId, value),
              )
            }
          >
            <Form.Item
              name="workspaceId"
              label="Workspace"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 260 }}
                options={workspaces.map((w) => ({
                  value: w.id,
                  label: w.name ?? w.externalId,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="executorAccountId"
              label="执行账号"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 240 }}
                options={accounts.map((a) => ({ value: a.id, label: a.email }))}
              />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue>
              <Switch />
            </Form.Item>
            <Button htmlType="submit">保存维护关系</Button>
          </Form>
        </Card>
        <Card title="维护状态">
          <Table
            rowKey="id"
            dataSource={data.maintenances}
            scroll={{ x: 1000 }}
            columns={[
              {
                title: "Workspace",
                render: (_, r) =>
                  String(r.workspace_name ?? r.external_id ?? "—"),
              },
              { title: "执行账号", dataIndex: "executor_email" },
              { title: "状态", dataIndex: "status" },
              {
                title: "启用",
                dataIndex: "enabled",
                render: (v) => (v ? <Tag color="green">是</Tag> : "否"),
              },
              {
                title: "上次运行",
                dataIndex: "last_run_at",
                render: formatTime,
              },
              {
                title: "下次运行",
                dataIndex: "next_run_at",
                render: formatTime,
              },
              { title: "错误", dataIndex: "last_error" },
              {
                title: "操作",
                fixed: "right",
                render: (_, r) => (
                  <Space>
                    <Button
                      size="small"
                      onClick={() =>
                        run(`run-${r.id}`, () =>
                          unifiedApi.runTeamOrders({
                            workspaceId: r.workspace_id,
                            source: "manual_workspace",
                          }),
                        )
                      }
                    >
                      立即运行
                    </Button>
                    <Button
                      size="small"
                      onClick={() =>
                        run(`pause-${r.id}`, () =>
                          unifiedApi.controlTeamOrder(
                            String(r.workspace_id),
                            r.enabled ? "pause" : "resume",
                          ),
                        )
                      }
                    >
                      {r.enabled ? "暂停" : "恢复"}
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        Modal.confirm({
                          title: "删除维护关系？",
                          onOk: () =>
                            run(`delete-${r.id}`, () =>
                              unifiedApi.controlTeamOrder(
                                String(r.workspace_id),
                                "delete",
                              ),
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
        </Card>
        <Card title="最近订单">
          <Table
            rowKey="id"
            dataSource={data.orders}
            scroll={{ x: 1200 }}
            columns={[
              {
                title: "Workspace",
                render: (_, r) =>
                  String(r.workspace_name ?? r.external_id ?? "—"),
              },
              { title: "执行账号", dataIndex: "executor_email" },
              {
                title: "状态",
                dataIndex: "status",
                render: (v) => <Tag>{String(v)}</Tag>,
              },
              { title: "Checkout", dataIndex: "checkout_url", ellipsis: true },
              {
                title: "更新时间",
                dataIndex: "updated_at",
                render: formatTime,
              },
              { title: "错误", dataIndex: "error_message" },
              {
                title: "操作",
                fixed: "right",
                render: (_, r) => (
                  <Space>
                    <Button
                      size="small"
                      onClick={() =>
                        run(`retry-${r.id}`, () =>
                          unifiedApi.retryTeamOrder(String(r.id)),
                        )
                      }
                    >
                      重试
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        Modal.confirm({
                          title: "删除订单记录？",
                          content:
                            "仅删除这条订单记录，不删除 Workspace 或维护关系。",
                          onOk: () =>
                            run(`delete-order-${r.id}`, () =>
                              unifiedApi.deleteTeamOrder(String(r.id)),
                            ),
                        })
                      }
                    >
                      删除订单
                    </Button>
                    <JsonViewer title="原始订单" value={r} />
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      </LoadBoundary>
    </Space>
  );
}
