import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { Modal } from 'antd';

/** Covers sidebar links, imperative navigation and browser back/forward. */
export function useUnsavedNavigation(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash
  ));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const dialog = Modal.confirm({
      title: '确认离开', content: '您有未保存的修改，离开后将丢失。',
      okText: '离开', cancelText: '继续编辑', okButtonProps: { danger: true },
      onOk: () => blocker.proceed(), onCancel: () => blocker.reset(),
    });
    return () => dialog.destroy();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);
}
