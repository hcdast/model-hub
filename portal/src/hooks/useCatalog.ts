import { useEffect, useState } from 'react';
import { catalogApi, CatalogModel } from '../services/catalog-api';

export function useCatalog() {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    catalogApi.list(controller.signal).then(({ items }) => {
      if (!controller.signal.aborted) setModels(items);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);
  return { models, loading, error, retry: () => setAttempt(value => value + 1) };
}
