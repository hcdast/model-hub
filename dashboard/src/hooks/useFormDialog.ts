import { useEffect, useRef, useState } from 'react';
import { Form } from 'antd';
import type { FormInstance } from 'antd';
import { useUnsavedClose } from './useUnsavedClose';

/** One guard for form edits, external selections, and the entire validation/save cycle. */
export function useFormDialog(open: boolean, form: FormInstance, busy: boolean, close: () => void, extra?: unknown) {
  const values = Form.useWatch(values => values, { form, preserve: true });
  const [baseline, setBaseline] = useState<string>();
  const lock = useRef(false);
  const [working, setWorking] = useState(false);
  const snapshot = () => JSON.stringify([form.getFieldsValue(true), extra]);
  useEffect(() => { setBaseline(open ? snapshot() : undefined); }, [open]);
  const dirty = open && baseline !== undefined && baseline !== JSON.stringify([values ?? form.getFieldsValue(true), extra]);
  const active = busy || working;
  const guardedClose = useUnsavedClose(dirty, active, close);
  return {
    dirty, busy: active,
    resetBaseline: () => setBaseline(snapshot()),
    run: async (action: () => Promise<void>) => {
      if (busy || lock.current) return;
      lock.current = true; setWorking(true);
      try { await action(); } finally { lock.current = false; setWorking(false); }
    },
    modalProps: { onCancel: guardedClose, confirmLoading: active, cancelButtonProps: { disabled: active }, maskClosable: !active, keyboard: !active, closable: !active },
  };
}
