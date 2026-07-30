import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import type { RrwebRecordingUploadView } from '@team-manager/shared';
import { ensurePrivateDirectory, writePrivateBuffer } from './privateDataFile.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const RECORDING_DIRECTORY = 'rrweb-recordings';
const RECORDING_SUFFIX = '.json.gz';
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const RECORDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RrwebRecordingStoreError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'RrwebRecordingStoreError';
  }
}

function eventCountFromRecording(recording: unknown): number {
  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) {
    throw new RrwebRecordingStoreError(400, 'rrweb 录制内容格式错误');
  }
  const value = recording as Record<string, unknown>;
  if (value.format !== 'team-manager-rrweb' || value.version !== 1 || !Array.isArray(value.events)) {
    throw new RrwebRecordingStoreError(400, 'rrweb 录制内容格式错误');
  }
  if (value.events.length < 2) throw new RrwebRecordingStoreError(400, 'rrweb 录制事件不足');
  return value.events.length;
}

export class RrwebRecordingStore {
  private readonly directory: string;

  constructor(dataDir: string) {
    this.directory = join(dataDir, RECORDING_DIRECTORY);
  }

  async init(): Promise<void> {
    await ensurePrivateDirectory(this.directory);
    await this.removeExpiredFiles();
  }

  async save(recording: unknown): Promise<RrwebRecordingUploadView> {
    const eventCount = eventCountFromRecording(recording);
    const json = JSON.stringify(recording);
    const uncompressedBytes = Buffer.byteLength(json);
    if (uncompressedBytes > MAX_RECORDING_BYTES) {
      throw new RrwebRecordingStoreError(413, 'rrweb 录制文件超过 25 MB 上限');
    }
    const compressed = await gzipAsync(Buffer.from(json), { level: 9 });
    const uuid = randomUUID();
    await writePrivateBuffer(this.path(uuid), compressed);
    await this.removeExpiredFiles();
    return {
      uuid,
      uploadedAt: Date.now(),
      eventCount,
      uncompressedBytes,
      compressedBytes: compressed.byteLength
    };
  }

  async read(uuid: string): Promise<unknown | null> {
    if (!UUID_PATTERN.test(uuid)) return null;
    try {
      const compressed = await readFile(this.path(uuid));
      return JSON.parse((await gunzipAsync(compressed)).toString('utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private path(uuid: string): string {
    return join(this.directory, `${uuid}${RECORDING_SUFFIX}`);
  }

  private async removeExpiredFiles(now = Date.now()): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(RECORDING_SUFFIX))
      .map(async (entry) => {
        const path = join(this.directory, entry.name);
        const metadata = await stat(path);
        if (now - metadata.mtimeMs > RECORDING_RETENTION_MS) await unlink(path);
      }));
  }
}
