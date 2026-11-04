import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { theme } from 'antd';

const PageRegions = createContext<{ header: HTMLDivElement | null; footer: HTMLDivElement | null } | null>(null);

/** Shared page shell: only the content scrolls; actions remain in normal flex layout. */
export default function PageFrame({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const regions = useMemo(() => ({ header, footer }), [header, footer]);
  return (
    <PageRegions.Provider value={regions}>
      <section className="admin-page-frame" style={{ background: token.colorBgContainer, borderColor: token.colorBorderSecondary, borderRadius: token.borderRadiusLG }}>
        <div className="admin-page-header" ref={setHeader} />
        <div className="admin-page-content">{children}</div>
        <div className="admin-page-footer" ref={setFooter} style={{ borderColor: token.colorBorderSecondary }} />
      </section>
    </PageRegions.Provider>
  );
}

export function PageHeaderRegion({ children }: { children: ReactNode }) {
  const regions = useContext(PageRegions);
  return regions?.header ? createPortal(children, regions.header) : <>{children}</>;
}

/** Use for save/reset/cancel actions on full-page forms. */
export function PageActions({ children }: { children: ReactNode }) {
  const regions = useContext(PageRegions);
  const actions = <div className="admin-page-actions" role="group" aria-label="页面操作">{children}</div>;
  return regions?.footer ? createPortal(actions, regions.footer) : actions;
}
