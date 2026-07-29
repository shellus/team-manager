import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { Pro5xOperationActions } from './Pro5xOperationActions.js';

describe('Pro5xOperationActions', () => {
  test('exposes same-IP retry, IP rotation and termination as distinct actions', () => {
    const html = renderToStaticMarkup(
      <Pro5xOperationActions
        operationId="operation-1"
        busyState={{}}
        onRetryCurrentStep={() => undefined}
        onRotateIp={() => undefined}
        onTerminate={() => undefined}
      />
    );

    expect(html).toContain('重试当前步骤');
    expect(html).toContain('更换 IP 并重试');
    expect(html).toContain('终止任务');
  });
});
