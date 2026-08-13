import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { configureTraceArtifactSink, installCatchAllFetchTracing } from './transport.js';
import { createDatabase, databaseHealth } from './database/connection.js';
import { assertMigrationsCurrent } from './database/migrator.js';
import { buildUnifiedApp } from './unifiedApp.js';
import { ArtifactStore } from './artifactStore.js';
import { ArtifactIndexRepository } from './repositories/artifactIndexRepository.js';

async function main() {
  const config = loadConfig();
  const database = createDatabase({ connectionString: config.databaseUrl });
  await databaseHealth(database);
  await assertMigrationsCurrent(database);
  const artifactStore = new ArtifactStore(config.artifactDir);
  const artifactIndexes = new ArtifactIndexRepository(database, artifactStore);
  configureTraceArtifactSink(async (record) => {
    const recordedAt = new Date();
    await artifactIndexes.save('traces', {
      fileName: `${recordedAt.toISOString().replaceAll(':', '-')}.json`,
      content: Buffer.from(JSON.stringify(record)),
      recordedAt,
      metadata: traceMetadata(record)
    });
  });
  installCatchAllFetchTracing();
  const app = await buildUnifiedApp({ config, database, artifactStore, startBackgroundTasks: true });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[team-manager] listening on :${info.port} (mode=unified-account-postgresql)`);
    if (config.jwtSecret === 'dev-insecure-secret-change-me') {
      console.warn('[team-manager] 警告: 使用默认 JWT secret，生产请设 TEAMMGR_JWT_SECRET');
    }
  });

  const shutdown = async () => {
    app.stopBackgroundTasks();
    await database.destroy();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

function traceMetadata(value: unknown): Record<string, unknown> {
  const row = record(value); const request = record(row?.request); const response = record(row?.response); const error = record(row?.error);
  return {
    source: 'runtime', ...(text(row?.upstream) ? { upstream: text(row?.upstream) } : {}),
    ...(text(request?.method) ? { method: text(request?.method) } : {}),
    ...(text(request?.url) ? { url: text(request?.url) } : text(request?.path) ? { path: text(request?.path) } : {}),
    ...(typeof response?.status === 'number' ? { statusCode: response.status } : {}),
    ...(typeof row?.durationMs === 'number' ? { durationMs: row.durationMs } : {}),
    ...(text(error?.message) ? { error: text(error?.message) } : {})
  };
}
function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function text(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}

main().catch((e) => {
  console.error('[team-manager] 启动失败:', e);
  process.exit(1);
});
