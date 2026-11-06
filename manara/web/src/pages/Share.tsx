import { Navigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../state';

/**
 * Web Share Target: other apps can "share to Manara" (text / link). The text is
 * passed to the companion as explicit context — the app never reads other apps by itself.
 */
export default function Share() {
  const [sp] = useSearchParams();
  const { me } = useApp();
  const text = [sp.get('title'), sp.get('text'), sp.get('url')].filter(Boolean).join('\n');
  // Written synchronously so it is there before the companion mounts.
  try {
    if (text) sessionStorage.setItem('manara.share', text);
  } catch {
    /* ignore */
  }
  const j = me?.journeys.find((x) => x.status === 'active') ?? me?.journeys[0];
  return <Navigate to={j ? `/j/${j.id}/companion` : '/'} replace />;
}
