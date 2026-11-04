import { create } from 'zustand';
import { Locale, translate } from './messages';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem('portal-language');
    if (saved === 'en' || saved === 'zh' || saved === 'ja') return saved;
  } catch { /* Storage can be disabled in private sessions. */ }
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language;
  return language.startsWith('zh') ? 'zh' : language.startsWith('ja') ? 'ja' : 'en';
}

const useLocaleStore = create<{ locale: Locale; setLocale: (locale: Locale) => void }>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try { localStorage.setItem('portal-language', locale); } catch { /* Keep the in-memory preference. */ }
    set({ locale });
  },
}));

export function useI18n() {
  const { locale, setLocale } = useLocaleStore();
  return { locale, setLocale, t: (key: string) => translate(locale, key) };
}
