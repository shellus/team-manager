import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accountEditorMode } from './AccountActions.js';
import { AccountsPage } from './AccountsPage.js';

describe('账号创建弹窗', () => {
  it('新建与编辑复用账号资料弹窗并显示各自字段', () => {
    expect(accountEditorMode()).toMatchObject({
      title: '添加账号',
      submitLabel: '创建账号',
      showEmail: true,
      showLimitType: false,
      showProxy: true,
    });
    expect(accountEditorMode({ email: 'account@example.com' })).toMatchObject({
      title: '编辑账号 · account@example.com',
      submitLabel: '保存账号资料',
      showEmail: false,
      showLimitType: true,
      showProxy: false,
    });
  });

  it('账号页直接提供添加账号和 GAM 注册两个弹窗入口', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <App>
          <AccountsPage />
        </App>
      </MemoryRouter>,
    );
    expect(html).toContain('添加账号');
    expect(html).toContain('GAM 注册');
    expect(html).not.toContain('手工录入已有账号，或让 GAM 注册一个新账号');
  });
});
