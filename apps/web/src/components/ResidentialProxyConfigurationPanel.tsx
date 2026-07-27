import type { ResidentialProxyConfig } from '@team-manager/shared';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Select, Skeleton, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ACCOUNT_PROXY_COUNTRIES } from './teamCheckoutOptions.js';

export function ResidentialProxyConfigurationPanel({
  loadConfig,
  saveConfig
}: {
  loadConfig: () => Promise<ResidentialProxyConfig>;
  saveConfig: (config: ResidentialProxyConfig) => Promise<ResidentialProxyConfig>;
}) {
  const [form] = Form.useForm<ResidentialProxyConfig>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const selectedAsn = Form.useWatch('asn', form);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void loadConfig()
      .then((config) => {
        if (!cancelled) form.setFieldsValue(config);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [form, loadConfig]);

  const submit = async (values: ResidentialProxyConfig) => {
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      const asn = normalizeResidentialProxyAsn(values.asn);
      const config = await saveConfig({
        sid: values.sid.trim(),
        country: values.country.trim().toUpperCase(),
        asn,
        state: asn ? null : values.state?.trim() || null,
        city: asn ? null : values.city?.trim() || null
      });
      form.setFieldsValue(config);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="residential-proxy-panel" aria-labelledby="residential-proxy-title">
      <div className="residential-proxy-heading">
        <div>
          <Typography.Title id="residential-proxy-title" level={5}>住宅代理配置</Typography.Title>
          <Typography.Text type="secondary">
            ASN 与州、城市互斥；调整任一定位条件时会自动更新 SID，避免粘连旧出口。
          </Typography.Text>
        </div>
      </div>
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      ) : (
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
          <div className="residential-proxy-grid">
            <Form.Item
              name="country"
              label="国家"
              rules={[{ required: true, message: '请选择国家' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={ACCOUNT_PROXY_COUNTRIES}
                placeholder="搜索国家代码或中文名"
                onChange={(country) => {
                  form.setFieldsValue(proxyLocationForCountry(country));
                  setSaved(false);
                }}
              />
            </Form.Item>
            <Form.Item
              name="asn"
              label="ASN"
              rules={[{
                validator: async (_, value) => {
                  normalizeResidentialProxyAsn(value);
                }
              }]}
              extra="可输入 AS64512 或 64512；填写后州和城市会清空并禁用。"
            >
              <Input
                allowClear
                maxLength={12}
                placeholder="可选，例如 AS64512"
                onChange={(event) => {
                  if (event.target.value.trim()) {
                    form.setFieldsValue({ state: null, city: null });
                  }
                  setSaved(false);
                }}
              />
            </Form.Item>
            <Form.Item name="state" label="州 / 省">
              <Input
                allowClear
                disabled={Boolean(selectedAsn?.trim())}
                maxLength={128}
                placeholder={selectedAsn ? '使用 ASN 时不可填写' : '可选，例如 California'}
                onChange={() => setSaved(false)}
              />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input
                allowClear
                disabled={Boolean(selectedAsn?.trim())}
                maxLength={128}
                placeholder={selectedAsn ? '使用 ASN 时不可填写' : '可选，例如 Los Angeles'}
                onChange={() => setSaved(false)}
              />
            </Form.Item>
            <Form.Item label="SID" required>
              <Space.Compact block>
                <Form.Item
                  name="sid"
                  noStyle
                  rules={[
                    { required: true, message: '请输入 SID' },
                    { pattern: /^[A-Za-z0-9_-]{1,64}$/u, message: 'SID 仅支持字母、数字、下划线和连字符' }
                  ]}
                >
                  <Input maxLength={64} placeholder="上游住宅代理 SID" />
                </Form.Item>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    form.setFieldValue('sid', randomSid());
                    setSaved(false);
                  }}
                >
                  生成随机 SID
                </Button>
              </Space.Compact>
            </Form.Item>
          </div>
          <Space size={12} wrap>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
              保存并应用
            </Button>
            {saved && <Typography.Text type="success">代理配置已生效</Typography.Text>}
          </Space>
        </Form>
      )}
      {error && <Alert className="residential-proxy-alert" type="error" showIcon message={error} />}
    </section>
  );
}

function randomSid(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function proxyLocationForCountry(
  country: string
): Pick<ResidentialProxyConfig, 'country' | 'state' | 'city'> {
  return { country, state: null, city: null };
}

export function normalizeResidentialProxyAsn(value: string | null | undefined): string | null {
  const raw = value?.trim().toUpperCase() || '';
  if (!raw) return null;
  const normalized = /^\d+$/u.test(raw) ? `AS${raw}` : raw;
  if (!/^AS[1-9]\d{0,9}$/u.test(normalized)) {
    throw new Error('ASN 必须是 AS 加数字，例如 AS64512');
  }
  const number = Number(normalized.slice(2));
  if (!Number.isSafeInteger(number) || number > 4_294_967_295) {
    throw new Error('ASN 超出有效范围');
  }
  return normalized;
}
