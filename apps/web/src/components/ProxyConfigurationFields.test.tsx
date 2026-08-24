import { Form } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ResidentialProxyConfig } from '@team-manager/shared';
import { generateResidentialProxySid, ProxyConfigurationFields } from './ProxyConfigurationFields.js';

describe('住宅代理 SID', () => {
  it('生成固定 8 位小写字母数字值', () => {
    expect(generateResidentialProxySid(() => 0)).toBe('aaaaaaaa');
    expect(generateResidentialProxySid(() => 0.99999999)).toBe('99999999');
  });

  it('按弹窗用途显示随机按钮', () => {
    expect(renderProxyFields(true)).toContain('aria-label="随机生成 8 位 SID"');
    expect(renderProxyFields(false)).not.toContain('aria-label="随机生成 8 位 SID"');
  });
});

function renderProxyFields(showRandomSidButton: boolean) {
  function ProxyForm() {
    const [form] = Form.useForm<ResidentialProxyConfig>();
    return (
      <Form form={form}>
        <ProxyConfigurationFields form={form} showRandomSidButton={showRandomSidButton} />
      </Form>
    );
  }

  return renderToStaticMarkup(<ProxyForm />);
}
