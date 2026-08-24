import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_DATE_FORMATS,
  PRODUCT_DATE_PRESETS,
  ProductDatePicker,
} from './ProductDatePicker.js';

describe('产品日期输入', () => {
  afterEach(() => vi.useRealTimers());

  it('使用可整段输入和粘贴的多格式文本日期', () => {
    expect(PRODUCT_DATE_FORMATS).toEqual(['YYYY-MM-DD', 'YYYY/M/D', 'YYYY年M月D日']);
    const html = renderToStaticMarkup(<ProductDatePicker value="2030-01-02" />);
    expect(html).toContain('placeholder="YYYY-MM-DD"');
    expect(html).toContain('value="2030-01-02"');
    expect(html).toContain('aria-label="日期快捷选择"');
    expect(html).toContain('>今天<');
    expect(html).toContain('>下个月<');
  });

  it('提供今天和下个月快捷项', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 24, 12));
    expect(PRODUCT_DATE_PRESETS.map((preset) => preset.label)).toEqual(['今天', '下个月']);
    expect(resolvePresetLocale(0)).toBe('zh-cn');
    expect(resolvePreset(0)).toBe('2026-08-24');
    expect(resolvePreset(1)).toBe('2026-09-24');
  });
});

function resolvePreset(index: number): string {
  const value = PRODUCT_DATE_PRESETS[index]?.value;
  if (!value) throw new Error('日期快捷项不存在');
  return (typeof value === 'function' ? value() : value).format('YYYY-MM-DD');
}

function resolvePresetLocale(index: number): string {
  const value = PRODUCT_DATE_PRESETS[index]?.value;
  if (!value) throw new Error('日期快捷项不存在');
  return (typeof value === 'function' ? value() : value).locale();
}
