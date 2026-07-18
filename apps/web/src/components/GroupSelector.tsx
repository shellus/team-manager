import { Radio } from 'antd';

export interface GroupSelectorOption {
  label: string;
  value: string;
}

export function GroupSelector({
  ariaLabel,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  value: string;
  options: GroupSelectorOption[];
  onChange: (value: string) => void;
}) {
  return (
    <Radio.Group
      className="group-selector"
      aria-label={ariaLabel}
      buttonStyle="solid"
      optionType="button"
      options={options}
      value={value}
      onChange={(event) => onChange(String(event.target.value))}
    />
  );
}
