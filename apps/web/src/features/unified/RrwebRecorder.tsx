import { useEffect, useRef, useState } from "react";
import { FloatButton, Typography } from "antd";
import {
  BugOutlined,
  LoadingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { unifiedApi } from "../../unifiedApi.js";
import { useProductMessage, useProductModal } from "../../components/ProductOverlays.js";

type RrEvent = { timestamp?: number } & Record<string, unknown>;
type RecordFn = (options: {
  emit: (event: RrEvent) => void;
  checkoutEveryNms: number;
  maskAllInputs: false;
  maskInputOptions: { password: false };
}) => (() => void) | undefined;

interface RecordingFile {
  format: "team-manager-rrweb";
  version: 1;
  createdAt: string;
  endedAt: string;
  page: {
    url: string;
    title: string;
    viewport: { width: number; height: number; devicePixelRatio: number };
  };
  events: RrEvent[];
}

export function RrwebRecorder() {
  const events = useRef<RrEvent[]>([]);
  const stop = useRef<(() => void) | undefined>();
  const message = useProductMessage();
  const modal = useProductModal();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      stop.current?.();
      stop.current = undefined;
    },
    [],
  );

  const start = async () => {
    try {
      const module = await import("rrweb");
      const record = (module as unknown as { record: RecordFn }).record;
      events.current = [];
      stop.current = record({
        emit: (event) => {
          events.current.push(event);
        },
        checkoutEveryNms: 30_000,
        // 此项目是个人管理工具，明确记录所有原始输入，包括 password。
        maskAllInputs: false,
        maskInputOptions: { password: false },
      });
      if (!stop.current) throw new Error("录制器启动失败");
      setRecording(true);
      message.info("rrweb 已开始按原文录制所有输入");
    } catch (reason) {
      message.error((reason as Error).message);
    }
  };

  const finish = async () => {
    stop.current?.();
    stop.current = undefined;
    setRecording(false);
    const content: RecordingFile = {
      format: "team-manager-rrweb",
      version: 1,
      createdAt: new Date(
        events.current[0]?.timestamp ?? Date.now(),
      ).toISOString(),
      endedAt: new Date().toISOString(),
      page: {
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      },
      events: [...events.current],
    };
    setBusy(true);
    try {
      const jsonBytes = new TextEncoder().encode(JSON.stringify(content));
      const stream = new Blob([jsonBytes as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const result = await unifiedApi.uploadRrweb(
        bytes,
        `${Date.now()}.json.gz`,
        content.createdAt,
      );
      modal.success({
        title: "前端录制已上报",
        content: (
          <div className="rrweb-upload-result">
            <Typography.Text type="secondary">将此 UUID 提供给开发者即可定位并回放本次现场。</Typography.Text>
            <Typography.Text code copyable>{result.id}</Typography.Text>
          </div>
        ),
        okText: "关闭",
      });
      events.current = [];
    } catch (reason) {
      message.error(`上传失败：${(reason as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatButton
      className={`rrweb-debug-button rr-ignore${recording ? " is-recording" : ""}${busy ? " is-busy" : ""}`}
      data-rrweb-ignore
      icon={busy ? <LoadingOutlined spin /> : recording ? <StopOutlined /> : <BugOutlined />}
      type="primary"
      onClick={() => {
        if (busy) return;
        void (recording ? finish() : start());
      }}
      aria-label={busy ? "正在上报前端录制" : recording ? "结束前端录制并上报" : "开始录制前端现场"}
    />
  );
}
