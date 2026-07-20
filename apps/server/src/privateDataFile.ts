import { appendFile, chmod, mkdir, writeFile } from 'node:fs/promises';

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function ensurePrivateFile(path: string): Promise<void> {
  await chmod(path, 0o600);
}

export async function writePrivateFile(path: string, body: string): Promise<void> {
  await writeFile(path, body, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

export async function appendPrivateFile(path: string, body: string): Promise<void> {
  await appendFile(path, body, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}
