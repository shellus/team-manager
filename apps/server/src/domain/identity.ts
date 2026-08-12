export const DEFAULT_ACCOUNT_GROUP_NAME = '默认分组';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeGroupName(value: string): string {
  return value.trim().toLowerCase();
}

export function requireEmail(value: string): string {
  const email = value.trim();
  if (!email || !email.includes('@')) throw new Error('账号邮箱无效');
  return email;
}

export function requireGroupName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('账号分组名称不能为空');
  return name;
}
