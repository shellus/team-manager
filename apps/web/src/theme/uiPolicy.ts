import type { ConfigProviderProps } from 'antd';

/**
 * 所有触发式弹层的唯一挂载策略。
 *
 * 挂到触发器父级后，弹层会随滚动容器移动；Select 的定位兜底统一写在
 * popupPolicy.css，业务页面不允许再提供 getPopupContainer 或定位补丁。
 */
export function productPopupContainer(triggerNode?: HTMLElement): HTMLElement {
  return triggerNode?.parentElement ?? document.body;
}

/** 所有分页器（包括 Table 内置分页器）共用同一个每页数量选择器配置。 */
export const productPageSizeChanger: NonNullable<
  NonNullable<ConfigProviderProps['pagination']>['showSizeChanger']
> = {
  showSearch: false,
  virtual: false,
  placement: 'topLeft',
  popupMatchSelectWidth: false,
};

/**
 * 由 ConfigProvider 统一下发的产品级 UI 行为。
 * 页面只负责业务值和选项，不再重复声明弹层、虚拟滚动或分页选择器策略。
 */
export const productUiPolicy = {
  virtual: false,
  popupOverflow: 'viewport',
  pagination: {
    showSizeChanger: productPageSizeChanger,
  },
  wave: {
    disabled: true,
  },
} satisfies Pick<
  ConfigProviderProps,
  'virtual' | 'popupOverflow' | 'pagination' | 'wave'
>;
