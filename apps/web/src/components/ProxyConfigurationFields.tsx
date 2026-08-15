import { Form, Input, Select } from 'antd';
import type { ResidentialProxyConfig } from '@team-manager/shared';
import { CHECKOUT_COUNTRY_OPTIONS } from './selectOptions.js';

export function ProxyConfigurationFields({ form }: { form: ReturnType<typeof Form.useForm<ResidentialProxyConfig>>[0] }) {
  const asn = Form.useWatch('asn', form);
  const state = Form.useWatch('state', form);
  const city = Form.useWatch('city', form);
  return (
    <div className="responsive-form-grid">
      <Form.Item name="sid" label="代理 SID" rules={[{ required: true, message: '请输入代理 SID' }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item name="country" label="国家" rules={[{ required: true, message: '请选择国家' }]}>
        <Select showSearch optionFilterProp="label" options={CHECKOUT_COUNTRY_OPTIONS} />
      </Form.Item>
      <Form.Item name="asn" label="ASN" rules={[{ validator: async (_, value) => { if (value && (state || city)) throw new Error('ASN 不能与州/省或城市同时使用'); } }]}>
        <Input allowClear disabled={Boolean(state || city)} autoComplete="off" placeholder={state || city ? '已使用地区定位' : '例如 AS7922'} />
      </Form.Item>
      <Form.Item name="state" label="州/省">
        <Input allowClear disabled={Boolean(asn)} autoComplete="off" placeholder={asn ? '已使用 ASN 定位' : undefined} />
      </Form.Item>
      <Form.Item name="city" label="城市" rules={[{ validator: async (_, value) => { if (value && !state) throw new Error('填写城市时必须同时填写州/省'); } }]}>
        <Input allowClear disabled={Boolean(asn)} autoComplete="off" placeholder={asn ? '已使用 ASN 定位' : undefined} />
      </Form.Item>
    </div>
  );
}
