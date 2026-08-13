import { describe, expect, it } from 'vitest';
import { parseCardQuickInput } from './cardQuickInput.js';

describe('parseCardQuickInput', () => {
  it('解析卡号、有效期和 CVC 快捷输入', () => {
    expect(parseCardQuickInput('4242424242424242----07/28----123')).toEqual({
      number: '4242424242424242', expiryMonth: 7, expiryYear: 2028, cvc: '123',
    });
  });
  it('拒绝不完整资料', () => expect(parseCardQuickInput('4242----07/28')).toBeUndefined());
});
