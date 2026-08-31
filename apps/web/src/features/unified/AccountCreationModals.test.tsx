import { App } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
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

  it('账号页弹窗和操作抽屉不再由查询参数驱动', () => {
    const source = readFileSync(new URL('./AccountsPage.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/params\.get\(["']modal["']\)/);
    expect(source).not.toMatch(/params\.get\(["']actionAccountId["']\)/);
    expect(source).not.toMatch(/params\.get\(["']operationId["']\)/);
    expect(source).not.toContain('setAccountActionInParams(params');
  });

  it('添加账号表单不会被浏览器识别为后台登录表单', () => {
    const source = readFileSync(new URL('./AccountActions.tsx', import.meta.url), 'utf8');
    const editor = source.slice(source.indexOf('export function AccountEditorModal'));

    expect(editor).toMatch(/<Form<AccountEditorValues>[^>]*autoComplete="off"/);
    expect(editor).toMatch(/name="email"[\s\S]*?<Input autoComplete="off" \/>/);
    expect(editor).toMatch(/name="proxy"[\s\S]*?<Input autoComplete="off" spellCheck=\{false\} \/>/);
    expect(editor).not.toMatch(/name="proxy"[\s\S]*?<Input\.Password/);
  });
});
