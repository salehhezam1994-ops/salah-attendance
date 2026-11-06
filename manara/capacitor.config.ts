import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native Android app is a thin shell around the deployed Manara server:
 * the WebView loads MANARA_SERVER_URL so the session cookie, the API and the
 * floating window all share the same origin. Set it when syncing:
 *   MANARA_SERVER_URL=https://manara.example.com npx cap sync android
 */
const serverUrl = process.env.MANARA_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'app.manara.knowledge',
  appName: 'منارة المعرفة',
  webDir: 'dist',
  ...(serverUrl ? { server: { url: serverUrl, cleartext: serverUrl.startsWith('http://') } } : {}),
  android: { allowMixedContent: false },
  plugins: {
    PushNotifications: { presentationOptions: ['alert', 'sound'] },
  },
};

export default config;
