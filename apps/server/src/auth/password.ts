import { compare, hash } from 'bcryptjs';

export const BCRYPT_COST = 12;
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordFitsBcrypt(password);
  return hash(password, BCRYPT_COST);
}

export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  if (!isSupportedBcryptHash(storedHash) || !passwordFitsBcrypt(password)) return false;
  try {
    return await compare(password, normalizeBcryptPrefix(storedHash));
  } catch {
    return false;
  }
}

export function isSupportedBcryptHash(value: string): boolean {
  return BCRYPT_HASH.test(value);
}

export function isBcryptLike(value: string): boolean {
  return value.startsWith('$2');
}

export function assertPasswordFitsBcrypt(password: string): void {
  if (!password) throw new Error('管理员密码不能为空');
  if (password.includes('\0')) throw new Error('管理员密码不能包含 NUL 字符');
  const length = Buffer.byteLength(password, 'utf8');
  if (length > 72) throw new Error('管理员密码超过 bcrypt 的 72 UTF-8 字节限制');
}

function passwordFitsBcrypt(password: string): boolean {
  try {
    assertPasswordFitsBcrypt(password);
    return true;
  } catch {
    return false;
  }
}

function normalizeBcryptPrefix(value: string): string {
  return value.startsWith('$2y$') ? `$2b$${value.slice(4)}` : value;
}
