import { App, Drawer, Modal, type DrawerProps, type ModalProps } from 'antd';

/** 继承当前主题与 ConfigProvider 上下文的命令式弹窗服务。 */
export function useProductModal() {
  return App.useApp().modal;
}

/** 继承当前主题与 ConfigProvider 上下文的全局反馈服务。 */
export function useProductMessage() {
  return App.useApp().message;
}

/** 声明式业务弹窗的统一生命周期；自定义 footer 仍可由调用方覆盖。 */
export function ProductModal(props: ModalProps) {
  return <Modal footer={null} destroyOnHidden {...props} />;
}

/** 声明式业务抽屉的统一生命周期。 */
export function ProductDrawer(props: DrawerProps) {
  return <Drawer destroyOnHidden {...props} />;
}
