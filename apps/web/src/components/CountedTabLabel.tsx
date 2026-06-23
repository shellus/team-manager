import { Badge, Space } from 'antd';

export function CountedTabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <Space size={6}>
      <span>{label}</span>
      {typeof count === 'number' && <Badge className="tab-count-badge" count={count} showZero size="small" />}
    </Space>
  );
}
