export class ServiceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function asServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/不存在|not found/i.test(message)) return new ServiceError(404, message);
  if (/duplicate key|unique constraint/i.test(message)) return new ServiceError(409, '记录已存在或名称冲突');
  if (/不能删除|没有管理|非空|不允许|不匹配|无效|不能为空/i.test(message)) return new ServiceError(409, message);
  return new ServiceError(500, message);
}
