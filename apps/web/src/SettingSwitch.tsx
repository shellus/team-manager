type SettingSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  offLabel?: string;
  onChange: (checked: boolean) => void;
  onLabel?: string;
};

export function SettingSwitch({
  checked,
  disabled = false,
  label,
  offLabel = '关闭',
  onChange,
  onLabel = '允许'
}: SettingSwitchProps) {
  return (
    <label className="setting-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{checked ? onLabel : offLabel}</span>
    </label>
  );
}
