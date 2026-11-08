#!/usr/bin/env node
// Reset (rule 3): asks a running instance to put its mode back to the default (Real if configured, else Mock).
// The edited policy lives in the browser; its Reset button restores that. Usage: node scripts/reset.mjs [http://127.0.0.1:7802]
const base = process.argv[2] || `http://127.0.0.1:${process.env.PORT || 7802}`;
try {
  const res = await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
  const body = await res.json();
  console.log(res.ok ? `reset: mode is ${body.source}` : `reset refused (${res.status}): ${body.message || body.error}`);
  process.exit(res.ok ? 0 : 1);
} catch (e) { console.error(`reset: cannot reach ${base} (${e.cause?.code || e.code || 'error'})`); process.exit(1); }
