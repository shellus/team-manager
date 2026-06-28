import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiTarget = env.TEAMMGR_DEV_API_TARGET;

  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      allowedHosts: true,
      ...(apiTarget
        ? {
            proxy: {
              '/api': apiTarget,
              '/public': apiTarget,
              '/health': apiTarget
            }
          }
        : {})
    },
    build: {
      outDir: 'dist'
    }
  };
});
