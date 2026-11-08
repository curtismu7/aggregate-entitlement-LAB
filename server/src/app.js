// One Express app: the API under /api and the built web UI when web/dist exists. createApp() is what tests use.
//
// Safety rules enforced here (each has a test):
//  - every request: loopback Host check (plus LAB_ALLOWED_HOSTS); every write: same-origin Origin check (security.js)
//  - an agent key is never in any response, log line or error (gateway/real.js scrubs every message)
//  - Mock never opens a socket; Real asks only the gateway named in the settings, and only lists tools or sends a name that is
//    NOT in the caller's listing (gateway/routes.js)
//  - rule 3: POST /api/reset puts the server's only state (the mode) back to its default
//  - rule 19: the Mock/Real toggle is server-side; POST /api/mode takes exactly { source }; GET /api/info answers
//    { source, realAvailable, realReason }; Real is 409-refused with the how-to when it is not configured
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createGatewayRouter } from './gateway/routes.js';
import { readSettings, realConfig } from './gateway/real.js';
import { createHealth } from './health.js';
import { LIMITS, RULES } from './scanner/rules.js';
import { hostCheck, sameOriginWrites } from './security.js';
import { shelfInfo } from './shelfLink.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bad = (res, message, status = 400, error = 'bad_request') => res.status(status).json({ error, message });

export function createApp({ env = process.env, health = createHealth({ env }) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck(env));
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    });
    next();
  });

  // Rule 19. Default: Real if it is configured, else Mock. The mode lives on the server and switches without a restart.
  const real = () => realConfig(readSettings(env));
  const defaultMode = () => (real().ok ? 'real' : 'mock');
  let mode = defaultMode();
  const modeView = () => {
    const cfg = real();
    if (mode === 'real' && !cfg.ok) mode = 'mock'; // a setting removed while running
    return { source: mode, realAvailable: cfg.ok, realReason: cfg.ok ? null : cfg.problem };
  };

  const api = express.Router();
  const small = express.json({ limit: '16kb' });
  api.use(sameOriginWrites(env));
  api.use('/health', health.router);
  api.use('/gateway', createGatewayRouter({ getMode: () => modeView().source, env }));

  api.get('/info', (_req, res) => res.set('Cache-Control', 'no-store').json(modeView()));
  api.post('/mode', small, (req, res) => {
    const body = req.body;
    if (!isObject(body) || Object.keys(body).some((k) => k !== 'source')) return bad(res, 'the only accepted body field is { "source": "mock" | "real" }.');
    if (body.source !== 'mock' && body.source !== 'real') return bad(res, 'source must be "mock" or "real".');
    if (body.source === 'real' && !real().ok) return res.status(409).json({ error: 'real_not_available', message: real().problem, source: modeView().source });
    mode = body.source;
    res.json(modeView());
  });

  // Reset (rule 3): the only state on the server is the mode, so Reset puts it back to the default. The policy a visitor edits
  // lives in the browser (the page's Reset button fetches the default again); nothing else is stored.
  api.post('/reset', small, (_req, res) => { mode = defaultMode(); res.json({ reset: true, ...modeView() }); });

  // The scan rules and what a scan cannot catch, for the Limits page.
  api.get('/rules', (_req, res) => res.json({ rules: Object.entries(RULES).map(([id, r]) => ({ id, ...r })), limits: LIMITS }));

  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    console.error('[aggregate-entitlement] api error:', err.code || err.name);
    return res.status(500).json({ error: 'server_error' });
  });
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}
