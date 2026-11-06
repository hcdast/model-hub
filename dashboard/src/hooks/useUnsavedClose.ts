import { Modal } from 'antd';

/** Used by editing dialogs: the close button, mask and Escape share one guard. */
export function useUnsavedClose(dirty: boolean, busy: boolean, close: () => void) {
  return () => {
    if (busy) return;
    if (!dirty) { close(); return; }
    Modal.confirm({ title: '放弃未保存的修改？', content: '关闭后，本次修改将丢失。', okText: '放弃修改', cancelText: '继续编辑', okButtonProps: { danger: true }, onOk: close });
  };
}
