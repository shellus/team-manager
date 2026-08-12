import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { createDatabase } from '../database/connection.js';
import { assertMigrationsCurrent } from '../database/migrator.js';
import { SecretCipher } from '../secretCipher.js';
import { LegacyImporter } from './legacyImporter.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const dataDir = resolve(argument('--data-dir') ?? config.dataDir);
  const artifactDir = resolve(argument('--artifact-dir') ?? config.artifactDir);
  const reportPath = resolve(argument('--report') ?? './legacy-import-report.json');
  const db = createDatabase({ connectionString: config.databaseUrl, applicationName: 'team-manager-legacy-import' });
  try {
    await assertMigrationsCurrent(db);
    const report = await db.transaction().execute((trx) => new LegacyImporter(trx, {
      dataDir,
      artifactDir,
      cipher: new SecretCipher(config.dataEncryptionKey, config.dataEncryptionKeyVersion)
    }).import());
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`迁移演练完成，报告：${reportPath}`);
    console.log(JSON.stringify({ counts: report.counts, conflicts: report.conflicts.length }));
    if (report.conflicts.some((conflict) => conflict.resolution === 'blocked')) process.exitCode = 2;
  } finally {
    await db.destroy();
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
