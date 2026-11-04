import { Button, Dropdown } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n';
import type { Locale } from '../../i18n/messages';

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const labels = { zh: '中文', en: 'English', ja: '日本語' };
  return (
    <Dropdown trigger={['click']} menu={{
      selectedKeys: [locale],
      items: Object.entries(labels).map(([key, label]) => ({ key, label })),
      onClick: ({ key }) => setLocale(key as Locale),
    }}>
      <Button icon={<GlobalOutlined />} aria-label={t('Language')}>{labels[locale]}</Button>
    </Dropdown>
  );
}
