import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './config.ts';
import { db, q } from './db.ts';
import api from './routes/api.ts';
import { HttpError, nowIso, safeLog } from './util.ts';

export function createApp() {
  const app = new Hono();
  app.use('*', secureHeaders({ contentSecurityPolicy: undefined, crossOriginEmbedderPolicy: false }));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message !== err.code ? err.message : undefined }, err.status as 400);
    safeLog(`${c.req.method} ${c.req.path}`, err);
    try {
      q.run('INSERT INTO error_log(at,context,message) VALUES (?,?,?)', nowIso(), `${c.req.method} ${c.req.routePath}`, err instanceof Error ? err.message.slice(0, 300) : 'error');
    } catch {
      /* ignore */
    }
    return c.json({ error: 'server_error' }, 500);
  });
  app.route('/api', api);

  const dist = path.resolve('dist');
  if (fs.existsSync(dist)) {
    app.use('/*', serveStatic({ root: './dist' }));
    // SPA fallback
    app.get('*', (c) => c.html(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')));
  }
  return app;
}

if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  db();
  const app = createApp();
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[manara] listening on http://localhost:${info.port} — AI mode: ${config.aiMode}`);
    if (config.aiMode === 'off') console.log('[manara] No ANTHROPIC_API_KEY: interview works; plans/lessons need AI (or MANARA_AI=demo for a declared demo).');
  });
}
