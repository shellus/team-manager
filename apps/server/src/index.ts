import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { AccountStore } from './accountStore.js';
import { SubaccountStore } from './subaccountStore.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  const store = new AccountStore(config.dataDir);
  await store.init();
  const subaccountStore = new SubaccountStore(config.dataDir);
  await subaccountStore.init();
  const app = await buildApp({ config, store, subaccountStore });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[team-manager] listening on :${info.port} (data=${config.dataDir})`);
    if (config.jwtSecret === 'dev-insecure-secret-change-me') {
      console.warn('[team-manager] 警告: 使用默认 JWT secret，生产请设 TEAMMGR_JWT_SECRET');
    }
  });
}

main().catch((e) => {
  console.error('[team-manager] 启动失败:', e);
  process.exit(1);
});
