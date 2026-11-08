import { useI18n } from '../../i18n';
import type { TemplateActivityMetrics } from '../../services/template-metrics';
export default function TemplateActivity({ metrics, drama = false }: { metrics?: TemplateActivityMetrics; drama?: boolean }) {
  const { t } = useI18n();
  if (!metrics) return null;
  return <div className="template-card-meta" aria-label={t('Template activity')}><span>{metrics.creators} {t('creators used this template')}</span><span>{metrics.completedProjects} {t(drama ? 'projects exported' : 'projects ran successfully')}</span></div>;
}
