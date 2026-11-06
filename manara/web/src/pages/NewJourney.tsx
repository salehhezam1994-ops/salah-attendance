import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../api';
import { useApp } from '../state';
import { ErrorBox, Loading } from '../components/ui';

/** Creates a journey and hands over to the interview immediately (no forms). */
export default function NewJourney() {
  const { locale, refresh } = useApp();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);
  const create = async () => {
    setErr(null);
    try {
      const r = await post<{ id: string }>('/journeys', { lang: locale });
      await refresh();
      nav(`/j/${r.id}/setup`, { replace: true });
    } catch (e: any) {
      setErr(e.code ?? 'default');
    }
  };
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="welcome">{err ? <ErrorBox code={err} onRetry={create} /> : <Loading />}</div>;
}
