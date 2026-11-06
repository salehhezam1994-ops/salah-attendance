import { useEffect } from 'react';
import { api } from './api';
import { useApp } from './state';
import { hasServerPush } from './push';

/**
 * Gentle local reminders through the Notification API while the app (or the
 * installed PWA) is running — used only as a fallback when this device has no
 * server push (otherwise the server sends the reminder): once a day at the chosen time if today's dose is
 * unread, plus due reviews. Never more than one of each per day.
 */
export function useReminders(journeyId: string | undefined) {
  const { me, t } = useApp();
  useEffect(() => {
    if (!journeyId || !me?.prefs.notify.enabled || typeof Notification === 'undefined' || hasServerPush()) return;
    const check = async () => {
      if (Notification.permission !== 'granted') return;
      const day = new Date().toISOString().slice(0, 10);
      const [hh, mm] = me.prefs.notify.dailyTime.split(':').map(Number);
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
      const key = `manara.notified.${journeyId}.${day}`;
      try {
        if (localStorage.getItem(key)) return;
        const home = await api(`/journeys/${journeyId}/home`);
        if (home.today && home.today.status !== 'read') {
          new Notification(t('app'), { body: t('todays_dose', { m: home.today.minutes ?? 5 }), icon: '/icon.svg', tag: 'daily' });
        } else if (me.prefs.notify.reviews && home.reviewsDue > 0) {
          new Notification(t('app'), { body: t('reviews_due', { n: home.reviewsDue }), icon: '/icon.svg', tag: 'review' });
        }
        localStorage.setItem(key, '1');
      } catch {
        /* storage or network unavailable: skip silently */
      }
    };
    void check();
    const id = window.setInterval(check, 60_000);
    return () => window.clearInterval(id);
  }, [journeyId, me?.prefs.notify.enabled, me?.prefs.notify.dailyTime, me?.prefs.notify.reviews, t]);
}
