import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { DownloadOutlined, EyeOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import { unifiedApi, type ArtifactView } from "../../unifiedApi.js";
import {
  JsonViewer,
  LoadBoundary,
  PageHeader,
  formatTime,
} from "../../components/ProductPrimitives.js";
import { RrwebReplay } from "../../components/RrwebReplay.js";

export function ArtifactsPage() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<ArtifactView[]>([]);
  const [selected, setSelected] = useState<{
    artifact: ArtifactView;
    content: unknown;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await unifiedApi.artifacts(params));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [params.toString()]);

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const status = params.get("status");
        const query = params.get("query")?.toLowerCase();
        return (
          (!status || row.status === status) &&
          (!query || JSON.stringify(row).toLowerCase().includes(query))
        );
      }),
    [params, rows],
  );

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const view = async (row: ArtifactView) => {
    try {
      const blob = await unifiedApi.artifactContent(row.kind, row.id);
      let content: unknown = blob;
      try {
        const response = row.storageKey.endsWith(".gz")
          ? new Response(
              blob.stream().pipeThrough(new DecompressionStream("gzip")),
            )
          : new Response(blob);
        content = JSON.parse(await response.text());
      } catch {
        content = blob;
      }
      setSelected({ artifact: row, content });
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const openClaim = (row: ArtifactView) => {
    setSelected({ artifact: row, content: undefined });
    set("modal", "claim");
  };

  const closeClaim = () => {
    set("modal");
    setSelected(undefined);
  };

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <Card>
        <PageHeader
          title="文件制品"
          description="HTTP trace、rrweb、凭证与隔离文件保持原文存储，页面完整读取，不做脱敏"
        />
      </Card>
      {error && <Alert type="error" showIcon message={error} />}
      <Card>
        <div className="filter-bar">
          <Select
            allowClear
            placeholder="制品类型"
            value={params.get("kind") ?? undefined}
            onChange={(value) => set("kind", value)}
            options={["trace", "rrweb", "credential", "quarantine"].map(
              (value) => ({ value, label: value }),
            )}
          />
          <Select
            allowClear
            placeholder="状态"
            value={params.get("status") ?? undefined}
            onChange={(value) => set("status", value)}
            options={[
              "active",
              "quarantined",
              "pending_delete",
              "deleted",
              "orphan",
            ].map((value) => ({ value, label: value }))}
          />
          <Input.Search
            placeholder="ID、路径、哈希"
            value={params.get("query") ?? ""}
            onChange={(event) => set("query", event.target.value)}
          />
        </div>
        <LoadBoundary
          loading={loading}
          error={error}
          empty={!filteredRows.length}
          onRetry={load}
        >
          <Table
            rowKey="id"
            dataSource={filteredRows}
            scroll={{ x: 1_200 }}
            columns={[
              {
                title: "类型",
                dataIndex: "kind",
                render: (value) => <Tag>{value}</Tag>,
              },
              { title: "ID", dataIndex: "id", ellipsis: true },
              { title: "状态", dataIndex: "status" },
              { title: "大小", dataIndex: "byteSize" },
              { title: "SHA-256", dataIndex: "contentSha256", ellipsis: true },
              { title: "存储键", dataIndex: "storageKey", ellipsis: true },
              { title: "时间", dataIndex: "recordedAt", render: formatTime },
              {
                title: "操作",
                fixed: "right",
                render: (_, row) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => void view(row)}
                    >
                      读取原文
                    </Button>
                    {row.kind === "quarantine" && (
                      <>
                        <Button size="small" onClick={() => openClaim(row)}>
                          认领
                        </Button>
                        <Button
                          size="small"
                          danger
                          loading={busy === `discard-${row.id}`}
                          onClick={() =>
                            Modal.confirm({
                              title: "明确丢弃隔离凭证？",
                              content:
                                "此操作使用隔离区专用生命周期，不调用通用制品删除。",
                              onOk: () =>
                                run(`discard-${row.id}`, () =>
                                  unifiedApi.discardQuarantinedCredential(
                                    row.id,
                                  ),
                                ),
                            })
                          }
                        >
                          丢弃
                        </Button>
                      </>
                    )}
                    {(row.kind === "trace" || row.kind === "rrweb") && (
                      <Button
                        size="small"
                        danger
                        loading={busy === `delete-${row.id}`}
                        onClick={() =>
                          Modal.confirm({
                            title: "将制品标记为待删除？",
                            content:
                              "后端将按宽限期和引用规则执行，不直接绕过生命周期。",
                            onOk: () =>
                              run(`delete-${row.id}`, () =>
                                unifiedApi.deleteArtifact(row.kind, row.id),
                              ),
                          })
                        }
                      >
                        进入待删除
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </LoadBoundary>
      </Card>
      <Drawer
        title="完整制品原文"
        open={Boolean(selected) && params.get("modal") !== "claim"}
        onClose={() => setSelected(undefined)}
        width="min(900px, 94vw)"
        extra={
          selected && (
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                download(fileName(selected.artifact), selected.content)
              }
            >
              下载原文
            </Button>
          )
        }
      >
        <Alert
          type="info"
          showIcon
          message="管理员调试入口完整展示原始内容，不做脱敏或截断。"
        />
        {selected?.artifact.kind === "rrweb" &&
          !(selected.content instanceof Blob) && (
            <RrwebReplay recording={selected.content} />
          )}
        <JsonViewer title="原始内容" value={selected?.content} />
        <JsonViewer title="制品元数据" value={selected?.artifact} />
      </Drawer>
      <Modal
        title="认领隔离凭证"
        open={params.get("modal") === "claim"}
        onCancel={closeClaim}
        footer={null}
      >
        <Form
          layout="vertical"
          onFinish={(value) =>
            run("claim", () =>
              unifiedApi.claimQuarantinedCredential(
                selected!.artifact.id,
                value,
              ),
            ).then(closeClaim)
          }
        >
          <Form.Item
            name="accountId"
            label="Account ID"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="workspaceId"
            label="Workspace ID"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={busy === "claim"}>
              认领到 Account × Workspace
            </Button>
            <Button
              danger
              loading={busy === "discard"}
              onClick={() =>
                run("discard", () =>
                  unifiedApi.discardQuarantinedCredential(
                    selected!.artifact.id,
                  ),
                ).then(closeClaim)
              }
            >
              明确丢弃
            </Button>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}

function fileName(artifact: ArtifactView) {
  const storageName = artifact.storageKey.split("/").pop();
  return storageName || `${artifact.kind}-${artifact.id}`;
}

function download(name: string, value: unknown) {
  const blob =
    value instanceof Blob
      ? value
      : new Blob([
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
        ]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
