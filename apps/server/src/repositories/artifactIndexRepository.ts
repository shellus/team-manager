import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { ArtifactStore, type ArtifactKind } from '../artifactStore.js';

export class ArtifactIndexRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly artifacts: ArtifactStore
  ) {}

  async save(kind: Extract<ArtifactKind, 'traces' | 'rrweb'>, input: {
    fileName: string; content: Uint8Array; recordedAt: Date | string;
    expiresAt?: Date | string | null; metadata?: Record<string, unknown>;
  }): Promise<string> {
    const artifact = await this.artifacts.writeImmutable(kind, input.fileName, input.content);
    const table = kind === 'traces' ? 'upstream_trace_segments' as const : 'rrweb_recordings' as const;
    const row = await this.db.insertInto(table).values({
      storage_key: artifact.storageKey, content_sha256: artifact.contentSha256,
      byte_size: artifact.byteSize, format_version: 1,
      recorded_at: input.recordedAt, expires_at: input.expiresAt ?? null,
      metadata: input.metadata ?? {}
    }).onConflict((oc) => oc.column('content_sha256').doUpdateSet({ status: 'active' }))
      .returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async read(kind: Extract<ArtifactKind, 'traces' | 'rrweb'>, id: string): Promise<Buffer> {
    const table = kind === 'traces' ? 'upstream_trace_segments' as const : 'rrweb_recordings' as const;
    const row = await this.db.selectFrom(table).select(['storage_key', 'content_sha256']).where('id', '=', id).executeTakeFirst();
    if (!row) throw new Error('文件制品索引不存在');
    return this.artifacts.read(row.storage_key, row.content_sha256);
  }

  async quarantineCredential(input: {
    fileName: string;
    content: Uint8Array;
    reasonCode: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const artifact = await this.artifacts.writeImmutable('credential-quarantine', input.fileName, input.content);
    const row = await this.db.insertInto('quarantined_artifacts').values({
      kind: 'credential',
      storage_key: artifact.storageKey,
      content_sha256: artifact.contentSha256,
      byte_size: artifact.byteSize,
      reason_code: input.reasonCode,
      metadata: input.metadata ?? {}
    }).onConflict((oc) => oc.column('content_sha256').doUpdateSet({ status: 'quarantined' }))
      .returning('id').executeTakeFirstOrThrow();
    return row.id;
  }
}
