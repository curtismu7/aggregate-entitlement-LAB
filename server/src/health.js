// GET /api/health, contract demo-health/1 (demo-shelf docs/health-contract.md). Public, GET only, no counts or detail.
// The state comes from the doctor checks, refreshed in the background every 60 s; a request never runs them.
// Pattern from the ID-JAG kit and hostile-mcp (same author).
import fs from 'node:fs';
import express from 'express';
import { allPassed, needsSetup, runChecks as defaultChecks } from './doctor.js';
import { readSettings, realConfig } from './gateway/real.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DEMO = { id: 'aggregate-entitlement', name: 'Aggregate entitlement lab', version };

export function createHealth({ runChecks = defaultChecks, env = process.env, now = () => new Date(), intervalMs = 60_000 } = {}) {
  let last = { state: 'unknown', at: null };
  function refresh() {
    try {
      const checks = runChecks({ env });
      last = { state: !allPassed(checks) ? 'broken' : needsSetup(checks) ? 'needs-setup' : 'ready', at: now().toISOString() };
    } catch { last = { state: 'unknown', at: now().toISOString() }; }
  }
  refresh();
  const timer = setInterval(refresh, intervalMs);
  timer.unref();

  const router = express.Router();
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ schema: 'demo-health/1', at: last.at || now().toISOString(), state: last.state, runtime: realConfig(readSettings(env)).ok ? 'live' : 'offline', demo: DEMO });
  });
  router.all('/', (_req, res) => res.set('Allow', 'GET').status(405).json({ error: 'method_not_allowed' }));
  return { router, refresh, stop: () => clearInterval(timer) };
}
