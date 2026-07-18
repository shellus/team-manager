import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { GroupSelector } from './GroupSelector.js';

describe('GroupSelector', () => {
  test('renders an accessible controlled radio group with the active option selected', () => {
    const html = renderToStaticMarkup(
      <GroupSelector
        ariaLabel="筛选子号分组"
        value="0719"
        options={[
          { label: '全部 (58)', value: 'all' },
          { label: '0718 (23)', value: '0718' },
          { label: '0719 (20)', value: '0719' }
        ]}
        onChange={() => undefined}
      />
    );

    expect(html).toContain('aria-label="筛选子号分组"');
    expect(html).toContain('class="ant-radio-group ant-radio-group-solid group-selector');
    expect(html).toMatch(/checked=""[^>]*value="0719"/);
  });
});
