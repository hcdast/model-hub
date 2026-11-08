import { Modal } from 'antd';
import { useEffect, useRef } from 'react';

/** Used by editing dialogs: the close button, mask and Escape share one guard. */
export function useUnsavedClose(dirty: boolean, busy: boolean, close: () => void) {
  const dialog = useRef<ReturnType<typeof Modal.confirm> | null>(null);
  const current = useRef({ busy, close });
  current.current = { busy, close };
  useEffect(() => () => { dialog.current?.destroy(); dialog.current = null; }, []);
  return () => {
    if (current.current.busy || dialog.current) return;
    if (!dirty) { close(); return; }
    dialog.current = Modal.confirm({
      title: '放弃未保存的修改？', content: '关闭后，本次修改将丢失。', okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true },
      onOk: () => { if (!current.current.busy) current.current.close(); },
      afterClose: () => { dialog.current = null; },
    });
  };
}
