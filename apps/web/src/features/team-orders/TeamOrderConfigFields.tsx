import { CHECKOUT_COUNTRY_CODES, CHECKOUT_CURRENCIES, type TeamOrderConfig } from '@team-manager/shared';
import { Form, Input, Select } from 'antd';

const countryOptions = CHECKOUT_COUNTRY_CODES.map((value) => ({ value, label: value }));
const currencyOptions = CHECKOUT_CURRENCIES.map((value) => ({ value, label: value }));

export function TeamOrderConfigFields({
  inherit,
  compact = false
}: {
  inherit?: TeamOrderConfig;
  compact?: boolean;
}) {
  const inherited = Boolean(inherit);
  return (
    <div className={compact ? 'team-order-config-grid compact' : 'team-order-config-grid'}>
      <Form.Item label="优惠码" name="promoCode">
        <Input
          allowClear
          placeholder={inherited ? `使用全局：${inherit!.promoCode || '无'}` : '可留空'}
        />
      </Form.Item>
      <Form.Item label="国家" name="country" rules={inherited ? undefined : [{ required: true, message: '请选择国家' }]}>
        <Select
          allowClear={inherited}
          showSearch
          optionFilterProp="label"
          options={countryOptions}
          placeholder={inherited ? `使用全局：${inherit!.country}` : '选择国家'}
        />
      </Form.Item>
      <Form.Item label="货币" name="currency" rules={inherited ? undefined : [{ required: true, message: '请选择货币' }]}>
        <Select
          allowClear={inherited}
          showSearch
          optionFilterProp="label"
          options={currencyOptions}
          placeholder={inherited ? `使用全局：${inherit!.currency}` : '选择货币'}
        />
      </Form.Item>
    </div>
  );
}
