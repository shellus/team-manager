import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const allowedHosts = (env.TEAMMGR_VITE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  const apiTarget = env.TEAMMGR_DEV_API_TARGET;

  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      ...(apiTarget
        ? {
            proxy: {
              '/api': apiTarget,
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
