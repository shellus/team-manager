import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { sha256 } from './secretCipher.js';

export type ArtifactKind = 'credentials' | 'rrweb' | 'traces';

export interface StoredArtifact {
  storageKey: string;
  contentSha256: string;
  byteSize: number;
}

export class ArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async writeImmutable(kind: ArtifactKind, fileName: string, content: Uint8Array): Promise<StoredArtifact> {
    const safeName = sanitizeFileName(fileName);
    const digest = sha256(content);
    const storageKey = `${kind}/${digest.slice(0, 2)}/${digest}-${safeName}`;
    const target = this.resolveStorageKey(storageKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      const existing = await readFile(target);
      if (sha256(existing) !== digest) throw new Error(`文件制品哈希冲突：${storageKey}`);
      return { storageKey, contentSha256: digest, byteSize: existing.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return { storageKey, contentSha256: digest, byteSize: content.byteLength };
  }

  async read(storageKey: string, expectedSha256: string): Promise<Buffer> {
    const content = await readFile(this.resolveStorageKey(storageKey));
    const actual = sha256(content);
    if (actual !== expectedSha256) throw new Error(`文件制品哈希不一致：${storageKey}`);
    return content;
  }

  async verify(storageKey: string, expectedSha256: string, expectedBytes: number): Promise<void> {
    const filePath = this.resolveStorageKey(storageKey);
    const info = await stat(filePath);
    if (info.size !== expectedBytes) throw new Error(`文件制品大小不一致：${storageKey}`);
    await this.read(storageKey, expectedSha256);
  }

  resolveStorageKey(storageKey: string): string {
    if (!/^(credentials|rrweb|traces)\/[a-z0-9][a-z0-9._/-]*$/i.test(storageKey)) {
      throw new Error('非法文件制品存储键');
    }
    const target = resolve(this.#root, storageKey);
    if (!target.startsWith(`${this.#root}${sep}`)) throw new Error('文件制品路径越界');
    return target;
  }
}

function sanitizeFileName(fileName: string): string {
  const normalized = basename(fileName).normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..') return 'artifact.bin';
  return normalized.slice(-160);
}
