import { useState, type ReactNode } from 'react';
import { Popconfirm, type PopconfirmProps } from 'antd';

export function ActionPopconfirm({
  children,
  loading,
  onConfirm,
  okButtonProps,
  ...props
}: Omit<PopconfirmProps, 'onConfirm' | 'open' | 'onOpenChange'> & {
  loading: boolean;
  children: ReactNode;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const confirm = async () => {
    await onConfirm();
    setOpen(false);
  };

  return (
    <Popconfirm
      {...props}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!loading) setOpen(nextOpen);
      }}
      okButtonProps={{ ...okButtonProps, loading }}
      onConfirm={() => void confirm()}
    >
      {children}
    </Popconfirm>
  );
}
