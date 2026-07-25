import { Button, Typography } from 'antd';
import {
  PARENT_QUICK_FILTER_GROUPS,
  type ParentQuickFilter
} from './parentQuickFilters.js';

export function ParentQuickFilterBar({
  value,
  onChange
}: {
  value: readonly ParentQuickFilter[];
  onChange: (filters: ParentQuickFilter[]) => void;
}) {
  const selected = new Set(value);
  const toggle = (
    filter: ParentQuickFilter,
    checked: boolean,
    group: typeof PARENT_QUICK_FILTER_GROUPS[number]
  ) => {
    const groupFilters = new Set<ParentQuickFilter>(group.options.map((option) => option.value));
    const withoutCurrentGroup = value.filter((current) => !groupFilters.has(current));
    if (group.selection === 'single') {
      onChange(checked ? [...withoutCurrentGroup, filter] : withoutCurrentGroup);
      return;
    }
    onChange(checked
      ? [...value, filter]
      : value.filter((current) => current !== filter));
  };

  return (
    <div className="parent-quick-filters" aria-label="快捷标签筛选">
      <div className="parent-quick-filter-head">
        <Typography.Text type="secondary">快捷筛选</Typography.Text>
        {value.length > 0 && (
          <Button type="link" size="small" onClick={() => onChange([])}>
            清除
          </Button>
        )}
      </div>
      <div className="parent-quick-filter-groups">
        {PARENT_QUICK_FILTER_GROUPS.map((group) => (
          <div className="parent-quick-filter-group" key={group.label}>
            <Typography.Text type="secondary" className="parent-quick-filter-label">
              {group.label}
            </Typography.Text>
            {group.options.map((option) => {
              const checked = selected.has(option.value);
              return (
                <Button
                  key={option.value}
                  className="parent-quick-filter-tag"
                  type={checked ? 'primary' : 'default'}
                  size="small"
                  shape="round"
                  autoInsertSpace={false}
                  aria-pressed={checked}
                  onClick={() => toggle(option.value, !checked, group)}
                >
                  <span>{option.label}</span>
                </Button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
