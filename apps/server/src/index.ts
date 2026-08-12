import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { installCatchAllFetchTracing } from './transport.js';
import { createDatabase, databaseHealth } from './database/connection.js';
import { assertMigrationsCurrent } from './database/migrator.js';
import { buildUnifiedApp } from './unifiedApp.js';

async function main() {
  installCatchAllFetchTracing();
  const config = loadConfig();
  const database = createDatabase({ connectionString: config.databaseUrl });
  await databaseHealth(database);
  await assertMigrationsCurrent(database);
  const app = await buildUnifiedApp({ config, database });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[team-manager] listening on :${info.port} (mode=unified-account-postgresql)`);
    if (config.jwtSecret === 'dev-insecure-secret-change-me') {
      console.warn('[team-manager] 警告: 使用默认 JWT secret，生产请设 TEAMMGR_JWT_SECRET');
    }
  });

  const shutdown = async () => {
    await database.destroy();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((e) => {
  console.error('[team-manager] 启动失败:', e);
  process.exit(1);
});
