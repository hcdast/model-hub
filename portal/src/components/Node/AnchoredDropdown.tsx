import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: ReactNode;
  children: ReactNode;
  minWidth?: number;
}

/** 锚定下拉菜单 — 通过 Portal 渲染，避免被节点 overflow 裁剪 */
export default function AnchoredDropdown({ open, onClose, anchor, children, minWidth = 240 }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open || !anchorRef.current) return;

    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const maxH = 240;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < maxH && rect.top > spaceBelow;

      if (openUp) {
        setStyle({
          position: 'fixed',
          top: rect.top - 6,
          left: rect.left,
          transform: 'translateY(-100%)',
          minWidth,
          zIndex: 10000,
        });
      } else {
        setStyle({
          position: 'fixed',
          top: rect.bottom + 6,
          left: rect.left,
          minWidth,
          zIndex: 10000,
        });
      }
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, minWidth]);

  return (
    <div ref={anchorRef} className="tapnow-dropdown-anchor nodrag nopan nowheel">
      {anchor}
      {open && createPortal(
        <>
          <div
            className="tapnow-dropdown-backdrop"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          />
          <div className="tapnow-model-dropdown tapnow-model-dropdown--portal" style={style}>
            {children}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
