import {
  CloudUploadOutlined,
  PlayCircleOutlined,
  StopOutlined,
  UploadOutlined,
  VideoCameraAddOutlined
} from '@ant-design/icons';
import { App, Button, Modal, Space, Tag, Tooltip, Typography, Upload } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { record, type eventWithTime } from 'rrweb';
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import type { RrwebRecordingUploadView } from '@team-manager/shared';
import { apiClient } from '../api.js';
import {
  createRrwebRecording,
  parseRrwebRecording,
  type RrwebRecordingFile
} from './rrwebRecording.js';

interface RecordingContext {
  createdAt: Date;
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
}

function recordingDuration(recording: RrwebRecordingFile): string {
  const duration = Math.max(0, Date.parse(recording.endedAt) - Date.parse(recording.createdAt));
  return `${Math.max(1, Math.round(duration / 1000))} 秒`;
}

function replaySize(recording: RrwebRecordingFile): { width: number; height: number } {
  const sourceWidth = Math.max(320, recording.page.viewport.width || 1280);
  const sourceHeight = Math.max(240, recording.page.viewport.height || 720);
  const availableWidth = Math.max(320, Math.min(1100, window.innerWidth - 96));
  const availableHeight = Math.max(240, window.innerHeight - 260);
  const scale = Math.min(1, availableWidth / sourceWidth, availableHeight / sourceHeight);
  return {
    width: Math.round(sourceWidth * scale),
    height: Math.round(sourceHeight * scale)
  };
}

function RrwebReplay({ recording }: { recording: RrwebRecordingFile }) {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!targetRef.current) return;
    const target = targetRef.current;
    target.replaceChildren();
    const size = replaySize(recording);
    const player = new rrwebPlayer({
      target,
      props: {
        events: recording.events,
        width: size.width,
        height: size.height,
        autoPlay: true,
        showController: true,
        skipInactive: true,
        speed: 1,
        speedOption: [0.5, 1, 2, 4, 8]
      }
    });
    return () => {
      player.pause();
      (player as unknown as { $destroy?: () => void }).$destroy?.();
      target.replaceChildren();
    };
  }, [recording]);

  return <div ref={targetRef} className="rrweb-replay-host" />;
}

export function RrwebDevTools() {
  const { message } = App.useApp();
  const eventsRef = useRef<eventWithTime[]>([]);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const contextRef = useRef<RecordingContext | null>(null);
  const [recording, setRecording] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [loadedRecording, setLoadedRecording] = useState<RrwebRecordingFile | null>(null);
  const [uploadResult, setUploadResult] = useState<RrwebRecordingUploadView | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setEventCount(eventsRef.current.length), 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    stopRecordingRef.current?.();
    stopRecordingRef.current = null;
  }, []);

  const recordingMeta = useMemo(() => loadedRecording ? [
    `${loadedRecording.events.length} 个事件`,
    recordingDuration(loadedRecording)
  ].join('，') : '', [loadedRecording]);

  const startRecording = () => {
    if (stopRecordingRef.current) return;
    eventsRef.current = [];
    setUploadResult(null);
    setEventCount(0);
    contextRef.current = {
      createdAt: new Date(),
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      }
    };
    const stop = record({
      emit(event) {
        eventsRef.current.push(event);
      },
      checkoutEveryNms: 30_000,
      ignoreSelector: '[data-rrweb-ignore]',
      maskInputOptions: { password: true },
      sampling: {
        mousemove: 50,
        scroll: 100,
        input: 'last'
      }
    });
    if (!stop) {
      contextRef.current = null;
      void message.error('rrweb 录制器启动失败');
      return;
    }
    stopRecordingRef.current = stop;
    setRecording(true);
    void message.info('已开始录制，请复现表单闪烁后点击“停止并上报”');
  };

  const uploadRecording = async (nextRecording: RrwebRecordingFile) => {
    setUploadResult(null);
    setUploading(true);
    try {
      const uploaded = await apiClient.uploadRrwebRecording(nextRecording);
      setUploadResult(uploaded);
      void message.success(`录制已上报，UUID：${uploaded.uuid}`);
    } catch (error) {
      void message.error(`录制上报失败：${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const stopAndUpload = () => {
    const stop = stopRecordingRef.current;
    const context = contextRef.current;
    if (!stop || !context) return;
    stop();
    stopRecordingRef.current = null;
    contextRef.current = null;
    setRecording(false);
    setEventCount(eventsRef.current.length);
    try {
      const nextRecording = createRrwebRecording({
        events: [...eventsRef.current],
        createdAt: context.createdAt,
        endedAt: new Date(),
        url: context.url,
        title: context.title,
        viewport: context.viewport
      });
      setLoadedRecording(nextRecording);
      void uploadRecording(nextRecording);
    } catch (error) {
      void message.error((error as Error).message);
    }
  };

  return (
    <>
      <div className="rrweb-dev-tools" data-rrweb-ignore>
        <Space size={8} wrap>
          <Tag color={recording ? 'error' : 'processing'}>rrweb</Tag>
          {recording ? (
            <>
              <Typography.Text type="secondary">录制中，{eventCount} 个事件</Typography.Text>
              <Button danger icon={<StopOutlined />} onClick={stopAndUpload}>
                停止并上报
              </Button>
            </>
          ) : (
            <Tooltip title="录制包含当前页面结构和交互；密码输入会被遮罩，停止后压缩保存到 Team Manager 私有数据目录">
              <Button
                type="primary"
                icon={<VideoCameraAddOutlined />}
                disabled={uploading}
                onClick={startRecording}
              >
                开始录制
              </Button>
            </Tooltip>
          )}
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={async (file) => {
              try {
                const nextRecording = parseRrwebRecording(await file.text());
                setLoadedRecording(nextRecording);
                setUploadResult(null);
                setReplayOpen(true);
              } catch (error) {
                void message.error((error as Error).message);
              }
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<UploadOutlined />} disabled={recording}>导入回放</Button>
          </Upload>
          {loadedRecording && !recording && (
            <>
              {uploading && <Tag icon={<CloudUploadOutlined />} color="processing">上报中</Tag>}
              {!uploading && !uploadResult && (
                <Button icon={<CloudUploadOutlined />} onClick={() => void uploadRecording(loadedRecording)}>
                  重新上报
                </Button>
              )}
              {uploadResult && (
                <Typography.Text className="rrweb-upload-uuid" code copyable={{ text: uploadResult.uuid }}>
                  UUID: {uploadResult.uuid}
                </Typography.Text>
              )}
              <Tooltip title={recordingMeta}>
                <Button icon={<PlayCircleOutlined />} onClick={() => setReplayOpen(true)}>
                  回放
                </Button>
              </Tooltip>
            </>
          )}
        </Space>
      </div>
      <Modal
        open={replayOpen && Boolean(loadedRecording)}
        title={loadedRecording ? `rrweb 回放：${loadedRecording.page.title}` : 'rrweb 回放'}
        width="min(1180px, calc(100vw - 48px))"
        footer={null}
        destroyOnHidden
        onCancel={() => setReplayOpen(false)}
      >
        {loadedRecording && (
          <Space direction="vertical" size={12} className="rrweb-replay-panel">
            <Typography.Text type="secondary">
              {recordingMeta}{loadedRecording.page.url ? `，${loadedRecording.page.url}` : ''}
            </Typography.Text>
            <RrwebReplay recording={loadedRecording} />
          </Space>
        )}
      </Modal>
    </>
  );
}
