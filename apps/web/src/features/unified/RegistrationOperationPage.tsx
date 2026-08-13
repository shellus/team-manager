import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Progress,
  Tag,
  Typography,
} from "antd";
import { useNavigate, useParams } from "react-router-dom";
import type { AccountManagerOperationView } from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { OperationDrawer } from "../../components/OperationDrawer.js";
import { useWebPreferences } from "../../webPreferences.js";

export function RegistrationOperationPage() {
  const { autoRefreshOperations } = useWebPreferences();
  const { operationId } = useParams();
  const navigate = useNavigate();
  const [operation, setOperation] = useState<AccountManagerOperationView>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!operationId) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await unifiedApi.registration(operationId);
        if (!active) return;
        setOperation(next.operation);
        if (next.accountId) {
          navigate(`/accounts/${next.accountId}`, { replace: true });
          return;
        }
        if (
          autoRefreshOperations &&
          !["succeeded", "failed", "interrupted"].includes(
            next.operation.status,
          )
        )
          setTimeout(poll, 2000);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      active = false;
    };
  }, [operationId, autoRefreshOperations]);
  return (
    <Card>
      <Typography.Title level={2}>账号注册操作</Typography.Title>
      {error && <Alert type="error" message={error} />}
      {operation && (
        <>
          <Progress
            percent={operation.progress}
            status={
              operation.status === "failed"
                ? "exception"
                : operation.status === "succeeded"
                  ? "success"
                  : "active"
            }
          />
          <Descriptions
            bordered
            items={[
              {
                key: "status",
                label: "状态",
                children: <Tag>{operation.status}</Tag>,
              },
              { key: "phase", label: "阶段", children: operation.phase },
              {
                key: "email",
                label: "邮箱",
                children: operation.email ?? "等待分配",
              },
              {
                key: "error",
                label: "错误",
                children: operation.errorMessage ?? "—",
              },
            ]}
          />
        </>
      )}
      <Button style={{ marginTop: 16 }} onClick={() => navigate("/accounts")}>
        返回账号列表
      </Button>
      {operation && (
        <OperationDrawer
          operation={operation}
          open
          onClose={() => navigate("/accounts")}
        />
      )}
    </Card>
  );
}
