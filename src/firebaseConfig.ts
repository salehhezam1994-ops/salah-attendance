/**
 * إعدادات مشروع Firebase (من Project settings ← Your apps ← Web app).
 * هذه القيم ليست سرية؛ الحماية تتم عبر قواعد Firestore ورمز المدرسة.
 * اتركها null لتعطيل المزامنة.
 */
const PROJECT_CONFIG: Record<string, string> | null = {
  apiKey: 'AIzaSyD8zwJRKF2tFp8GeiQW_Hdr9xxyCBZz3IM',
  authDomain: 'salah-attendance.firebaseapp.com',
  projectId: 'salah-attendance',
  storageBucket: 'salah-attendance.firebasestorage.app',
  messagingSenderId: '62852234169',
  appId: '1:62852234169:web:0cd62384242da335079468',
};

// للاختبار المحلي: VITE_FIREBASE_CONFIG='{"apiKey":"x","projectId":"demo-x"}' و VITE_FB_EMULATOR=1
const envCfg = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
export const firebaseConfig: Record<string, string> | null = envCfg ? JSON.parse(envCfg) : PROJECT_CONFIG;
export const useEmulator = import.meta.env.VITE_FB_EMULATOR === '1';
