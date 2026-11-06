import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api, post } from './api';

/**
 * Server push registration.
 *  - Browser / installed PWA: Web Push through the service worker (VAPID).
 *  - Native Android app: Firebase Cloud Messaging via @capacitor/push-notifications.
 * Always triggered by an explicit user action (the switch in preferences).
 */
export const isNative = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform() as 'android' | 'ios' | 'web';

export type PushSupport = 'native' | 'webpush' | 'local-only' | 'none';
export function pushSupport(): PushSupport {
  if (isNative()) return 'native';
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'none';
  if ('serviceWorker' in navigator && 'PushManager' in window) return 'webpush';
  return 'local-only';
}

const setFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem('manara.push', '1');
    else localStorage.removeItem('manara.push');
  } catch {
    /* ignore */
  }
};
export const hasServerPush = () => {
  try {
    return localStorage.getItem('manara.push') === '1';
  } catch {
    return false;
  }
};

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

let nativeListeners = false;
async function enableNative(): Promise<'granted' | 'denied' | 'unsupported' | 'error'> {
  // Native push needs Firebase on both sides (google-services.json in the app, service account on the server).
  const { fcm } = await api<{ fcm: boolean }>('/push/config');
  if (!fcm) return 'unsupported';
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return 'denied';
  if (!nativeListeners) {
    nativeListeners = true;
    await PushNotifications.addListener('registration', (t) => {
      try {
        localStorage.setItem('manara.fcmToken', t.value);
      } catch {
        /* ignore */
      }
      void post('/push/subscribe', { kind: 'fcm', token: t.value, platform: nativePlatform() === 'ios' ? 'ios' : 'android' }).then(() => setFlag(true)).catch(() => undefined);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const url = (a.notification.data as { url?: string } | undefined)?.url;
      if (url) window.location.assign(url);
    });
  }
  if (nativePlatform() === 'android') {
    await PushNotifications.createChannel({ id: 'manara_default', name: 'منارة المعرفة', description: 'الجرعة اليومية والمراجعة والمستجدات', importance: 3, visibility: 1 }).catch(() => undefined);
  }
  await PushNotifications.register();
  return 'granted';
}

export async function enablePush(): Promise<'granted' | 'denied' | 'unsupported' | 'error'> {
  const s = pushSupport();
  try {
    if (s === 'native') return await enableNative();
    if (s === 'none') return 'unsupported';
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return 'denied';
    if (s === 'local-only') return 'granted'; // in-app reminders only (e.g. iOS Safari before installing the app)
    const reg = await navigator.serviceWorker.ready;
    const { webPushPublicKey } = await api<{ webPushPublicKey: string }>('/push/config');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(webPushPublicKey) });
    const j = sub.toJSON();
    await post('/push/subscribe', { kind: 'webpush', subscription: { endpoint: j.endpoint, keys: j.keys } });
    setFlag(true);
    return 'granted';
  } catch {
    return 'error';
  }
}

export async function disablePush() {
  setFlag(false);
  try {
    if (isNative()) {
      const token = localStorage.getItem('manara.fcmToken');
      if (token) await post('/push/unsubscribe', { endpoint: token }).catch(() => undefined);
      await PushNotifications.unregister();
      return;
    }
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}
