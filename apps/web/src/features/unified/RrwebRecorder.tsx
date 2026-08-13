import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Space, Tag, Typography, message } from "antd";
import {
  PlayCircleOutlined,
  StopOutlined,
  VideoCameraAddOutlined,
} from "@ant-design/icons";
import { unifiedApi } from "../../unifiedApi.js";
import { RrwebReplay } from "../../components/RrwebReplay.js";

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
  const [enabled, setEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [preview, setPreview] = useState<RecordingFile>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const onPreferences = (event: Event) => {
      const preferences = (event as CustomEvent<Record<string, unknown>>)
        .detail;
      const nextEnabled = preferences?.rrwebEnabled === true;
      if (!nextEnabled && stop.current) {
        stop.current();
        stop.current = undefined;
        events.current = [];
        setEventCount(0);
        setRecording(false);
        message.info("rrweb 已按 Web 偏好关闭，未完成的录制未上传");
      }
      setEnabled(nextEnabled);
    };
    window.addEventListener("team-manager:web-preferences", onPreferences);
    void unifiedApi
      .systemSettings()
      .then((settings) => {
        if (!active) return;
        const preferences = settings.find(
          (row) => row.key === "web.preferences",
        )?.value;
        setEnabled(preferences?.rrwebEnabled === true);
      })
      .catch(() => setEnabled(false));
    return () => {
      active = false;
      window.removeEventListener("team-manager:web-preferences", onPreferences);
      stop.current?.();
      stop.current = undefined;
    };
  }, []);

  const start = async () => {
    try {
      const module = await import("rrweb");
      const record = (module as unknown as { record: RecordFn }).record;
      events.current = [];
      setEventCount(0);
      stop.current = record({
        emit: (event) => {
          events.current.push(event);
          setEventCount(events.current.length);
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
    setPreview(content);
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
      message.success(`录制已保存：${result.id}`);
    } catch (reason) {
      message.error(`上传失败：${(reason as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <>
      <div className="rrweb-dev-tools" data-rrweb-ignore>
        <Space wrap>
          <Tag color={recording ? "error" : "processing"}>rrweb 原文录制</Tag>
          {recording ? (
            <>
              <Typography.Text>{eventCount} 个事件</Typography.Text>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={() => void finish()}
              >
                停止并上传
              </Button>
            </>
          ) : (
            <Button
              icon={<VideoCameraAddOutlined />}
              loading={busy}
              onClick={() => void start()}
            >
              开始录制
            </Button>
          )}
          {preview && !recording && (
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => setPreview({ ...preview })}
            >
              回放最近录制
            </Button>
          )}
        </Space>
      </div>
      <Modal
        title="最近 rrweb 录制"
        open={Boolean(preview) && !recording}
        onCancel={() => setPreview(undefined)}
        footer={null}
        width="min(1120px, 94vw)"
      >
        <Alert
          type="warning"
          showIcon
          message="该录制包含所有输入原文，包括 password；页面不做脱敏。"
        />
        {preview && <RrwebReplay recording={preview} />}
      </Modal>
    </>
  );
}
