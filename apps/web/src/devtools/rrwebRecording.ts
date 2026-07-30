import type { eventWithTime } from 'rrweb';

export const RRWEB_RECORDING_FORMAT = 'team-manager-rrweb';
export const RRWEB_RECORDING_VERSION = 1;

export interface RrwebRecordingFile {
  format: typeof RRWEB_RECORDING_FORMAT;
  version: typeof RRWEB_RECORDING_VERSION;
  createdAt: string;
  endedAt: string;
  page: {
    url: string;
    title: string;
    viewport: {
      width: number;
      height: number;
      devicePixelRatio: number;
    };
  };
  events: eventWithTime[];
}

function isEventWithTime(value: unknown): value is eventWithTime {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<eventWithTime>;
  return typeof event.type === 'number' && typeof event.timestamp === 'number';
}

function validateEvents(value: unknown): eventWithTime[] {
  if (!Array.isArray(value) || value.length < 2 || !value.every(isEventWithTime)) {
    throw new Error('录制文件缺少有效的 rrweb 事件');
  }
  return value;
}

export function createRrwebRecording(input: {
  events: eventWithTime[];
  createdAt: Date;
  endedAt: Date;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
}): RrwebRecordingFile {
  return {
    format: RRWEB_RECORDING_FORMAT,
    version: RRWEB_RECORDING_VERSION,
    createdAt: input.createdAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    page: {
      url: input.url,
      title: input.title,
      viewport: input.viewport
    },
    events: validateEvents(input.events)
  };
}

export function parseRrwebRecording(text: string): RrwebRecordingFile {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    const events = validateEvents(parsed);
    const firstTimestamp = events[0].timestamp;
    const lastTimestamp = events[events.length - 1].timestamp;
    return {
      format: RRWEB_RECORDING_FORMAT,
      version: RRWEB_RECORDING_VERSION,
      createdAt: new Date(firstTimestamp).toISOString(),
      endedAt: new Date(lastTimestamp).toISOString(),
      page: {
        url: '',
        title: 'rrweb 录制',
        viewport: { width: 1280, height: 720, devicePixelRatio: 1 }
      },
      events
    };
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的 rrweb 录制文件');
  const recording = parsed as Partial<RrwebRecordingFile>;
  if (
    recording.format !== RRWEB_RECORDING_FORMAT
    || recording.version !== RRWEB_RECORDING_VERSION
    || !recording.page
  ) {
    throw new Error('不支持的 rrweb 录制文件格式');
  }
  return {
    ...recording,
    events: validateEvents(recording.events)
  } as RrwebRecordingFile;
}
