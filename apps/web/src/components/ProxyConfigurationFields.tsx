import { Button, Form, Input, Select, Space, type InputProps } from 'antd';
import {
  isResidentialProxySid,
  RESIDENTIAL_PROXY_SID_LENGTH,
  type ResidentialProxyConfig,
} from '@team-manager/shared';
import { CHECKOUT_COUNTRY_OPTIONS } from './selectOptions.js';

export function generateResidentialProxySid(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: RESIDENTIAL_PROXY_SID_LENGTH },
    () => alphabet[Math.floor(random() * alphabet.length)],
  ).join('');
}

interface ProxySidInputProps extends Omit<InputProps, 'onChange'> {
  onChange?: (value: string) => void;
  showRandomButton?: boolean;
}

function ProxySidInput({ onChange, showRandomButton, ...inputProps }: ProxySidInputProps) {
  return (
    <Space.Compact block>
      <Input
        {...inputProps}
        autoComplete="off"
        maxLength={RESIDENTIAL_PROXY_SID_LENGTH}
        pattern="[A-Za-z0-9]*"
        placeholder="8 位字母或数字"
        onChange={(event) => onChange?.(event.target.value)}
      />
      {showRandomButton && (
        <Button
          htmlType="button"
          aria-label="随机生成 8 位 SID"
          onClick={() => onChange?.(generateResidentialProxySid())}
        >
          随机
        </Button>
      )}
    </Space.Compact>
  );
}

export function ProxyConfigurationFields({
  form,
  showRandomSidButton = false,
}: {
  form: ReturnType<typeof Form.useForm<ResidentialProxyConfig>>[0];
  showRandomSidButton?: boolean;
}) {
  const asn = Form.useWatch('asn', form);
  const state = Form.useWatch('state', form);
  const city = Form.useWatch('city', form);
  return (
    <div className="responsive-form-grid">
      <Form.Item
        name="sid"
        label="代理 SID"
        rules={[{
          validator: async (_, value) => {
            if (!value) throw new Error('请输入代理 SID');
            if (!isResidentialProxySid(value)) throw new Error('代理 SID 必须是 8 位字母或数字');
          },
        }]}
      >
        <ProxySidInput showRandomButton={showRandomSidButton} />
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
