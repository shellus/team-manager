export class ServiceError extends Error {
  public readonly upstreamStatus?: number;

  constructor(
    public readonly status: number,
    message: string,
    options: { upstreamStatus?: number } = {}
  ) {
    super(message);
    this.name = 'ServiceError';
    this.upstreamStatus = options.upstreamStatus;
  }
}

export function upstreamHttpError(
  upstreamStatus: number,
  message: string,
  status = publicStatusForUpstream(upstreamStatus)
): ServiceError {
  return new ServiceError(status, message, { upstreamStatus });
}

export function asServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const upstreamStatus = numericStatus(error, 'upstreamStatus') ?? numericStatus(error, 'status');
  if (upstreamStatus !== undefined) return upstreamHttpError(upstreamStatus, message);
  if (/不存在|not found/i.test(message)) return new ServiceError(404, message);
  if (/duplicate key|unique constraint/i.test(message)) return new ServiceError(409, '记录已存在或名称冲突');
  if (/不能删除|没有管理|非空|不允许|不匹配|无效|不能为空/i.test(message)) return new ServiceError(409, message);
  return new ServiceError(500, message);
}

function publicStatusForUpstream(status: number): number {
  if (status === 401) return 502;
  return status >= 400 && status < 500 ? status : 502;
}

function numericStatus(error: unknown, field: 'status' | 'upstreamStatus'): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}
