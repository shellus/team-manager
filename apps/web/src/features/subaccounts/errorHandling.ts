import { ApiError } from '../../api.js';

export function shouldForwardSubaccountErrorToGlobal(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
