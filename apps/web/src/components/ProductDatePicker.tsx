import { Button, DatePicker, type DatePickerProps } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn');

export const PRODUCT_DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/M/D', 'YYYY年M月D日'] as const;

export const PRODUCT_DATE_PRESETS: NonNullable<DatePickerProps['presets']> = [
  { label: '今天', value: () => dayjs().startOf('day') },
  { label: '下个月', value: () => dayjs().add(1, 'month').startOf('day') },
];

export interface ProductDatePickerProps extends Omit<
  DatePickerProps,
  'classNames' | 'defaultValue' | 'format' | 'multiple' | 'onChange' | 'picker' | 'presets' | 'value'
> {
  value?: string | null;
  onChange?: (value: string | null) => void;
}

/**
 * 产品内业务日期的统一输入组件。
 *
 * 使用普通文本解析而不是分段 mask，因此允许整段键入或粘贴；表单值始终保持
 * PostgreSQL date 使用的 YYYY-MM-DD 字符串。
 */
export function ProductDatePicker({ value, onChange, style, ...props }: ProductDatePickerProps) {
  const parsedValue = value ? dayjs(value) : null;
  return (
    <div className="product-date-picker-field">
      <DatePicker
        {...props}
        value={parsedValue?.isValid() ? parsedValue : null}
        onChange={(date) => onChange?.(date ? date.format('YYYY-MM-DD') : null)}
        format={[...PRODUCT_DATE_FORMATS]}
        presets={PRODUCT_DATE_PRESETS}
        classNames={{ popup: { root: 'product-date-picker-popup' } }}
        placeholder="YYYY-MM-DD"
        needConfirm={false}
        showToday
        style={{ width: '100%', ...style }}
      />
      <div className="product-date-picker-mobile-shortcuts" aria-label="日期快捷选择">
        {PRODUCT_DATE_PRESETS.map((preset, index) => (
          <Button
            key={index}
            type="link"
            size="small"
            htmlType="button"
            disabled={props.disabled}
            onClick={() => onChange?.(productDatePresetValue(index).format('YYYY-MM-DD'))}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function productDatePresetValue(index: number) {
  const value = PRODUCT_DATE_PRESETS[index]?.value;
  if (!value) throw new Error('日期快捷项不存在');
  return typeof value === 'function' ? value() : value;
}
