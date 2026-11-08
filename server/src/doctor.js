// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a value that
// could be a secret (no keys, no env values). Each check: { id, level: 'pass' | 'info' | 'setup' | 'fail', detail }.
import { allowedHostNames, assertBindAllowed, bindHost } from './security.js';
import { readSettings, realConfig } from './gateway/real.js';

export function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try {
    const host = assertBindAllowed(bindHost(env), env);
    add('bind', 'pass', env.AGG_ENT_BIND ? `${host} (AGG_ENT_BIND opt-in; also accepts ${allowedHostNames(env).length} extra Host name(s))` : `${host} (loopback)`);
  } catch (e) { add('bind', 'fail', e.message); }

  // Real is optional: Mock needs nothing. Say whether Real is set up, never the URL or a key.
  const cfg = realConfig(readSettings(env));
  add('real', cfg.ok ? 'info' : 'pass', cfg.ok ? `Real is configured: ${cfg.apps.length} app(s), ${cfg.callers.length} agent key(s)` : 'Real is not configured (optional): Mock works without it');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
export const needsSetup = (checks) => checks.some((c) => c.level === 'setup');
