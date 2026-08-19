import { loadConfig } from '../config.js';
import { createDatabase } from './connection.js';
import { migrateToLatest, pendingMigrations } from './migrator.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'status') throw new Error('Usage: db:migrate | db:status');
  const config = await loadConfig();
  const db = createDatabase({ connectionString: config.databaseUrl, applicationName: `team-manager-${command}` });
  try {
    if (command === 'migrate') {
      const applied = await migrateToLatest(db);
      console.log(applied.length > 0 ? `已应用 migration：${applied.join(', ')}` : '数据库已是最新版本');
      return;
    }
    const pending = await pendingMigrations(db);
    console.log(pending.length > 0 ? `待应用 migration：${pending.join(', ')}` : '数据库已是最新版本');
    if (pending.length > 0) process.exitCode = 2;
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
