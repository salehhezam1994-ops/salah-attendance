import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no extra dependency). Real env vars take precedence.
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined && m[2] !== '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export type AiMode = 'anthropic' | 'demo' | 'off';

function resolveAiMode(): AiMode {
  const m = (process.env.MANARA_AI || '').toLowerCase();
  if (m === 'demo') return 'demo';
  if (m === 'off') return 'off';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'off';
}

export const config = {
  port: Number(process.env.PORT || 8787),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  aiMode: resolveAiMode(),
  modelStrong: process.env.MANARA_MODEL_STRONG || 'claude-opus-5-5',
  modelFast: process.env.MANARA_MODEL_FAST || 'claude-haiku-5-5',
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  production: process.env.NODE_ENV === 'production',
  sessionDays: 90,
  // External scholarly APIs; each one is optional and failures are tolerated.
  sourceTimeoutMs: Number(process.env.SOURCE_TIMEOUT_MS || 7000),
  // Push notifications. VAPID keys are generated and stored in DATA_DIR if not provided.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  // Firebase Cloud Messaging for the native Android app: service-account JSON (inline or file path).
  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT || '',
  schedulerIntervalMs: Number(process.env.NOTIFY_INTERVAL_MS || 60000),
  contactUserAgent: 'ManaraKnowledge/0.1 (scholarly companion app)',
};
