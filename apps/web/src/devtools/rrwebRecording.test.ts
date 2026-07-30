import { describe, expect, test } from 'vitest';
import type { eventWithTime } from 'rrweb';
import {
  createRrwebRecording,
  parseRrwebRecording
} from './rrwebRecording.js';

const events = [
  { type: 4, data: {}, timestamp: 1 },
  { type: 2, data: { node: { type: 0, childNodes: [] }, initialOffset: { left: 0, top: 0 } }, timestamp: 2 }
] as eventWithTime[];

describe('rrweb recording file', () => {
  test('creates and parses the Team Manager recording envelope', () => {
    const recording = createRrwebRecording({
      events,
      createdAt: new Date('2026-07-30T03:00:00.000Z'),
      endedAt: new Date('2026-07-30T03:00:05.000Z'),
      url: 'https://example.test/subaccounts',
      title: 'Team Manager',
      viewport: { width: 1440, height: 900, devicePixelRatio: 2 }
    });

    expect(parseRrwebRecording(JSON.stringify(recording))).toEqual(recording);
  });

  test('accepts a standard raw rrweb event array', () => {
    const recording = parseRrwebRecording(JSON.stringify(events));

    expect(recording.events).toEqual(events);
    expect(recording.page.title).toBe('rrweb 录制');
  });

  test('rejects files without a usable event stream', () => {
    expect(() => parseRrwebRecording('{"events":[]}')).toThrow('不支持的 rrweb 录制文件格式');
    expect(() => parseRrwebRecording('[]')).toThrow('录制文件缺少有效的 rrweb 事件');
  });
});
