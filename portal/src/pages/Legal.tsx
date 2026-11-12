import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from 'antd';
import BrandIcon from '../components/BrandIcon';
import LanguageSwitcher from '../components/Layout/LanguageSwitcher';
import { useI18n } from '../i18n';
import { legalContent, type LegalDocument } from '../i18n/legal';
import './Legal.css';

export default function Legal({ document: documentType }: { document: LegalDocument }) {
  const { locale, t } = useI18n();
  const copy = legalContent[locale];
  const content = copy[documentType];

  useEffect(() => {
    window.scrollTo(0, 0);
    const previousTitle = document.title;
    document.title = `${content.title} | Model Hub`;
    return () => { document.title = previousTitle; };
  }, [content.title]);

  return (
    <div className="portal-legal">
      <header className="portal-legal-header">
        <Link to="/" className="portal-legal-brand"><BrandIcon /> <span>Model Hub</span></Link>
        <LanguageSwitcher />
      </header>
      <main className="portal-legal-main">
        <nav className="portal-legal-nav" aria-label={copy.navigation}>
          <Link to="/terms" aria-current={documentType === 'terms' ? 'page' : undefined}>{t('Terms of Service')}</Link>
          <Link to="/privacy" aria-current={documentType === 'privacy' ? 'page' : undefined}>{t('Privacy Policy')}</Link>
        </nav>
        <article className="portal-legal-document" aria-labelledby="legal-title">
          <h1 id="legal-title">{content.title}</h1>
          <Alert type="warning" showIcon message={copy.reviewTitle} description={copy.reviewDescription} />
          <p className="portal-legal-intro">{content.introduction}</p>
          {content.sections.map((section, index) => (
            <section key={section.title}>
              <h2>{index + 1}. {section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </article>
        <footer className="portal-legal-footer">
          <Link to="/login">{copy.backToLogin}</Link>
          <Link to="/">{copy.backToHome}</Link>
        </footer>
      </main>
    </div>
  );
}
