import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Empty, List, Pagination, Popover, Space, Spin, Switch, Tag } from 'antd';
import { BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { notificationApi, NotificationPage, PortalNotification } from '../../services/notification-api';
import './notifications.css';

const statusText = { succeeded: 'Workflow succeeded', failed: 'Workflow failed', cancelled: 'Workflow cancelled' };
const statusColor = { succeeded: 'success', failed: 'error', cancelled: 'default' };

/** Mounted with the user ID as key: requests and cached rows never cross login sessions. */
export default function NotificationBell() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [count, setCount] = useState<number>();
  const [data, setData] = useState<NotificationPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const mutating = useRef(false);
  const request = useRef<AbortController>();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      if (mutating.current || document.visibilityState === 'hidden') return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (open) setLoading(true);
      try {
        if (open) {
          const response = await notificationApi.list(page, unreadOnly, controller.signal);
          if (!active || controller.signal.aborted) return;
          if (response.code !== 0) throw new Error('Invalid response');
          const lastPage = Math.max(1, Math.ceil(response.data.total / 8));
          if (page > lastPage) { setPage(lastPage); return; }
          setData(response.data); setCount(response.data.unreadCount);
        } else {
          const response = await notificationApi.count(controller.signal);
          if (!active || controller.signal.aborted) return;
          if (response.code !== 0) throw new Error('Invalid response');
          setCount(response.data.count);
        }
        setError(false);
      } catch {
        if (active && !controller.signal.aborted) { setError(true); setCount(undefined); }
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      active = false; request.current?.abort(); window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible);
    };
  }, [open, page, unreadOnly, revision]);

  async function acknowledge(item?: PortalNotification, view = false) {
    if (mutating.current) return;
    mutating.current = true; setBusy(true); setActionError(false); request.current?.abort();
    try {
      if (!item || !item.read) {
        const response = item ? await notificationApi.read(item.id) : await notificationApi.readAll();
        if (response.code !== 0) throw new Error('Invalid response');
        if (!alive.current) return;
        setCount(response.data.count);
      }
      if (!alive.current) return;
      setError(false);
      if (view && item?.href) { setOpen(false); navigate(item.href); }
    } catch {
      if (alive.current) setActionError(true);
    } finally {
      mutating.current = false;
      if (alive.current) { setBusy(false); setRevision(value => value + 1); }
    }
  }

  const content = <section className="portal-notifications" aria-label={t('Notifications')}>
    <div className="portal-notifications-heading">
      <strong>{t('Notifications')}</strong>
      <Space size="small">
        <Button size="small" icon={<ReloadOutlined />} aria-label={t('Refresh notifications')} disabled={busy || loading} onClick={() => setRevision(value => value + 1)} />
        <Button size="small" disabled={busy || !count} onClick={() => void acknowledge()}>{t('Mark all as read')}</Button>
      </Space>
    </div>
    <p className="portal-notifications-hint">{t('Your workflow and short drama results appear here.')}</p>
    <label className="portal-notifications-filter">
      <Switch size="small" checked={unreadOnly} disabled={busy} onChange={value => { setUnreadOnly(value); setPage(1); setData(null); }} />
      {t('Unread only')}
    </label>
    {(error || actionError) && <Alert type="error" showIcon message={t('Unable to load or update notifications. Please retry.')} action={<Button size="small" disabled={busy} onClick={() => { setActionError(false); setRevision(value => value + 1); }}>{t('Retry')}</Button>} />}
    <Spin spinning={loading}>
      {!error && data && data.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(unreadOnly ? 'No unread notifications' : 'No workflow notifications yet')} /> :
        <List dataSource={data?.items || []} renderItem={item => <List.Item className={item.read ? '' : 'portal-notification-unread'}>
          <div className="portal-notification-item">
            <Space size="small"><Tag color={statusColor[item.status]}>{t(item.type === 'drama_result' ? (item.status === 'succeeded' ? 'Short drama result ready' : 'Short drama needs attention') : statusText[item.status])}</Tag>{!item.read && <Badge status="processing" aria-label={t('Unread')} />}</Space>
            <strong className="portal-notification-name">{item.workflowName || t('Deleted workflow')}</strong>
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US')}</time>
            <span className="portal-notification-id">{t('Run ID')}: {item.id}</span>
            <Space wrap>
              {!item.read && <Button size="small" type="link" disabled={busy} onClick={() => void acknowledge(item)}>{t('Mark as read')}</Button>}
              {item.href && <Button size="small" type="link" disabled={busy} onClick={() => void acknowledge(item, true)}>{t(item.type === 'drama_result' ? 'View short drama' : 'View workflow')}</Button>}
            </Space>
          </div>
        </List.Item>} />}
    </Spin>
    {!!data?.total && <Pagination size="small" current={page} total={data.total} pageSize={8} showSizeChanger={false} disabled={busy || loading} onChange={value => { setPage(value); setData(null); }} />}
  </section>;

  return <Popover trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} content={content}>
    <Badge count={error || actionError ? '!' : count} size="small" overflowCount={99}>
      <Button className="portal-notification-bell" type="text" icon={<BellOutlined />} aria-label={t('Notifications')} aria-expanded={open} title={t(error || actionError ? 'Unable to load or update notifications. Please retry.' : 'Notifications')} />
    </Badge>
  </Popover>;
}
