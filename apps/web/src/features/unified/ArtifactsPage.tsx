import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useSearchParams } from "react-router-dom";
import type { QuarantinedCredentialClaimInput } from "@team-manager/shared";
import {
  unifiedApi,
  type ArtifactView,
  type CredentialPoolGroupView,
} from "../../unifiedApi.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";
import { RrwebReplay } from "../../components/RrwebReplay.js";
import { ProductDrawer, ProductModal, useProductModal } from "../../components/ProductOverlays.js";
import { normalizedArtifactParams, parseRrwebRecording } from "./unifiedUiModels.js";
import { useUrlPagination } from "../../components/urlPagination.js";

export function ArtifactsPage() {
  const productModal = useProductModal();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<ArtifactView[]>([]);
  const [poolGroups, setPoolGroups] = useState<CredentialPoolGroupView[]>([]);
  const [recording, setRecording] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [artifacts, groups] = await Promise.all([
        unifiedApi.artifacts(params),
        unifiedApi.credentialPoolGroups(),
      ]);
      setRows(artifacts);
      setPoolGroups(groups);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const queryKey=`${params.get("kind")??""}:${params.get("status")??""}`;
  useEffect(() => { void load(); }, [queryKey]);
  useEffect(()=>{const next=normalizedArtifactParams(params);if(next.toString()!==params.toString())setParams(next,{replace:true});},[params,setParams]);

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
  const pagination = useUrlPagination({ total: filteredRows.length, pageSizeStorageKey: "artifacts" });

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

  const replay = async (row: ArtifactView) => {
    try {
      const blob = await unifiedApi.artifactContent(row.kind, row.id);
      const response = row.storageKey.endsWith(".gz")
        ? new Response(blob.stream().pipeThrough(new DecompressionStream("gzip")))
        : new Response(blob);
      setRecording(parseRrwebRecording(await response.text()));
      const next=new URLSearchParams(params);next.set("modal","replay");next.set("artifactId",row.id);setParams(next);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const openClaim = (row: ArtifactView) => {
    const next=new URLSearchParams(params);next.set("modal","claim");next.set("artifactId",row.id);setParams(next);
  };

  const closeClaim = () => {
    const next=new URLSearchParams(params);next.delete("modal");next.delete("artifactId");setParams(next);
  };
  const selected=rows.find(row=>row.id===params.get("artifactId"));
  useEffect(()=>{if(params.get("modal")==="replay"&&selected?.kind==="rrweb"&&recording===undefined)void replayContent(selected).then(setRecording).catch(reason=>setError((reason as Error).message));},[params,selected,recording]);
  useEffect(()=>{if(!loading&&["replay","claim"].includes(params.get("modal")??"")&&!selected)closeClaim();},[loading,params,selected]);

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <Card>
        <PageHeader
          title="文件制品"
          description="查看 HTTP 请求日志、rrweb 录制和凭证文件的索引、状态与生命周期"
          actions={<Upload accept="application/json,.json" showUploadList={false} beforeUpload={file=>{void file.text().then(text=>{setRecording(parseRrwebRecording(text));const next=new URLSearchParams(params);next.set("modal","local-replay");next.delete("artifactId");setParams(next);}).catch(reason=>setError((reason as Error).message));return false;}}><Button>导入本地 rrweb 回放</Button></Upload>}
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
            options={["trace", "rrweb", "credential", "quarantine", "orphan"].map(
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
              "missing",
              "claimed",
              "discarded",
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
            pagination={pagination}
            scroll={{ x: 1_200 }}
            columns={[
              {
                title: "类型",
                dataIndex: "kind",
                render: (value) => <Tag>{value}</Tag>,
              },
              { title: "ID", dataIndex: "id", ellipsis: true },
              { title: "状态", dataIndex: "status" },
              { title: "摘要", render:(_,row)=><ArtifactMetadata row={row}/> },
              { title: "大小", dataIndex: "byteSize", render:formatBytes },
              { title: "SHA-256", dataIndex: "contentSha256", ellipsis: true },
              { title: "存储键", dataIndex: "storageKey", ellipsis: true },
              { title: "时间", dataIndex: "recordedAt", render: formatTime },
              {
                title: "操作",
                fixed: "right",
                render: (_, row) => (
                  <Space>
                    {row.kind === "rrweb" && (
                      <Button size="small" onClick={() => void replay(row)}>
                        回放录制
                      </Button>
                    )}
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
                            productModal.confirm({
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
                          productModal.confirm({
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
      <ProductDrawer
        title="rrweb 录制回放"
        open={["replay","local-replay"].includes(params.get("modal")??"")}
        onClose={() => {setRecording(undefined);closeClaim();}}
        width="min(900px, 94vw)"
      >
        {recording !== undefined && (
          <RrwebReplay recording={recording} />
        )}
      </ProductDrawer>
      <ProductModal
        title="认领隔离凭证"
        open={params.get("modal") === "claim"}
        onCancel={closeClaim}
      >
        <Form
          layout="vertical"
          initialValues={{ kind: "oauth" }}
          onFinish={(value: QuarantinedCredentialClaimInput) =>
            run("claim", () =>
              unifiedApi.claimQuarantinedCredential(
                selected!.id,
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
          <Form.Item name="kind" label="凭证类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "oauth", label: "OAuth" },
                { value: "pat", label: "PAT" },
              ]}
            />
          </Form.Item>
          <Form.Item name="poolGroupId" label="号池分组 ID（可选）">
            <Select
              allowClear
              options={poolGroups.map((group) => ({
                value: group.id,
                label: group.name,
              }))}
            />
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
                    selected!.id,
                  ),
                ).then(closeClaim)
              }
            >
              明确丢弃
            </Button>
          </Space>
        </Form>
      </ProductModal>
    </Space>
  );
}

async function replayContent(row:ArtifactView){const blob=await unifiedApi.artifactContent(row.kind,row.id);const response=row.storageKey.endsWith(".gz")?new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))):new Response(blob);return parseRrwebRecording(await response.text());}
function ArtifactMetadata({row}:{row:ArtifactView}){const entries=metadataEntries(row.metadata);return entries.length?<Space direction="vertical" size={0}>{entries.map(([label,value])=><Typography.Text key={label} type="secondary">{label}：{value}</Typography.Text>)}</Space>:"—";}
function metadataEntries(value:Record<string,unknown>){const fields:Array<[string,string[]]>=[['上游',['upstream','service']],['方法',['method']],['响应',['status','statusCode']],['耗时',['durationMs','duration']],['来源',['source']],['内容类型',['contentType']],['账号',['accountId']],['Workspace',['workspaceId']],['凭证',['credentialKind']],['原因',['reason']]];return fields.flatMap(([label,keys])=>{const key=keys.find(item=>['string','number','boolean'].includes(typeof value[item]));return key?[[label,String(value[key])] as [string,string]]:[];});}
function formatBytes(value:number){if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024/1024).toFixed(1)} MB`;}
