import { Capacitor, registerPlugin } from '@capacitor/core';

/** Native floating window (Android). See android/.../FloatingCompanionPlugin.java. */
type FloatingPlugin = {
  status(): Promise<{ supported: boolean; permission: boolean; running: boolean }>;
  requestPermission(): Promise<{ permission: boolean }>;
  start(o: { url: string; minimizeApp?: boolean }): Promise<void>;
  stop(): Promise<void>;
};
export const FloatingCompanion = registerPlugin<FloatingPlugin>('FloatingCompanion');
export const nativeFloatingAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
