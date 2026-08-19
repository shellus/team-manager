import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceError, asServiceError, upstreamHttpError } from './serviceError.js';

test('上游 HTTP 状态与 Team Manager 响应状态分层保存', () => {
  for (const [upstreamStatus, status] of [[400, 400], [401, 502], [403, 403], [404, 404], [429, 429], [500, 502], [503, 502]]) {
    const error = upstreamHttpError(upstreamStatus, `upstream ${upstreamStatus}`);
    assert.equal(error.status, status);
    assert.equal(error.upstreamStatus, upstreamStatus);
  }
});

test('带状态的上游客户端错误统一转换并保留 upstreamStatus', () => {
  const error = asServiceError(Object.assign(new Error('GAM unauthorized'), { status: 401 }));
  assert.equal(error.status, 502);
  assert.equal(error.upstreamStatus, 401);
});

test('Team Manager 本地业务错误不产生 upstreamStatus', () => {
  const error = asServiceError(new ServiceError(401, '未授权'));
  assert.equal(error.status, 401);
  assert.equal(error.upstreamStatus, undefined);
});
