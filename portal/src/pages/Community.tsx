import { Navigate, useSearchParams } from 'react-router-dom';

/** Preserve existing community links while keeping a single discovery experience. */
export default function Community() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('source', 'community');
  return <Navigate to={`/discover?${next}`} replace />;
}
