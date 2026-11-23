// Rule 27: the vendored shared/run-observability files match web/src/run-observability/run-observability.sha256 byte for byte.
// They come from curtismu7/AI-DEMO-Standalone shared/run-observability: change them there, re-pin, re-vendor; never edit them here.
// This lab reads no logs (Mock is the simulation, Real is what the lab receives from the gateway, shown as `response` rows), so it vendors the core only:
// no server/src/runObservabilityReaders.js, and no file of this lab names a reader or a RUN_OBS_ setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPin } from './run-observability-checkPin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// The only files outside the pin that may name a reader setting, by EXACT lab-relative path (never a suffix): none. The core is vendored and its own "no log reader is
// configured" message names the setting a lab WITH readers would set, so it is the one vendored file skipped by the scan below.
const VENDORED_CORE = 'server/src/runObservability.js';
const VENDORED_WEB = 'web/src/run-observability';

test('every vendored run-observability file matches its pin, and the core is present', () => {
  assert.deepEqual(checkPin(root), []);
});

test('an edited vendored byte, a missing pin and an unpinned file are each caught', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'aggent-pin-'));
  try {
    for (const p of [VENDORED_WEB, VENDORED_CORE]) fs.cpSync(path.join(root, p), path.join(copy, p), { recursive: true });
    assert.deepEqual(checkPin(copy), [], 'an untouched copy is fine');
    const css = path.join(copy, VENDORED_WEB, 'run-observability.css');
    fs.appendFileSync(css, ' ');
    assert.ok(checkPin(copy).length > 0, 'one added byte');
    fs.writeFileSync(css, fs.readFileSync(path.join(root, VENDORED_WEB, 'run-observability.css')));
    fs.writeFileSync(path.join(copy, VENDORED_WEB, 'extra.js'), 'export {};\n');
    assert.ok(checkPin(copy).some((m) => /extra\.js/.test(m)), 'a file beside them that the pin does not name');
    fs.rmSync(path.join(copy, VENDORED_WEB, 'extra.js'));
    fs.rmSync(path.join(copy, VENDORED_WEB, 'run-observability.sha256'));
    assert.ok(checkPin(copy).length > 0, 'no pin file');
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});

test('this lab reads no logs: no readers file, no server file names a reader or a RUN_OBS_ setting (comments included), and the core has no imports', () => {
  assert.ok(!fs.existsSync(path.join(root, 'server/src/runObservabilityReaders.js')));
  const core = read(VENDORED_CORE);
  assert.ok(!/^\s*import\s/m.test(core), 'the core has no imports');
  assert.ok(!/ElasticsearchReader|DockerLogReader|readersFromEnv|\bfetch\s*\(|node:http|node:fs/.test(core), 'the core names no reader, no network and no file access, not even in a comment');
  for (const f of fs.readdirSync(path.join(root, 'server/src'), { recursive: true }).filter((n) => n.endsWith('.js') && n !== 'runObservability.js')) {
    assert.ok(!/RUN_OBS_|runObservabilityReaders|ElasticsearchReader|DockerLogReader|readersFromEnv/.test(read(`server/src/${f}`)), `server/src/${f} names a log reader`);
  }
});

test('compose, the example settings and the Dockerfile never mount the Docker socket and carry no run-observability setting (nothing reads one)', () => {
  for (const f of ['docker-compose.yml', '.env.example', 'Dockerfile']) {
    assert.ok(!/docker\.sock/.test(read(f)), `${f}: no Docker socket`);
    assert.ok(!/RUN_OBS_/.test(read(f)), `${f}: no reader settings`);
  }
});

test('no lab file outside the vendored files carries the RUN_OBS_ prefix (the web code included), and the README says what is not verified', () => {
  const walk = (rel) => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((d) => {
    const child = `${rel}/${d.name}`;
    if (d.isDirectory()) return d.name === 'node_modules' || child === VENDORED_WEB ? [] : walk(child);
    return child === VENDORED_CORE ? [] : [child];
  });
  for (const f of [...walk('web/src'), ...walk('server/src')]) assert.ok(!/RUN_OBS_/.test(read(f)), `${f} carries a RUN_OBS_ name`);
  const readme = read('README.md');
  assert.match(readme, /\*\*Not verified\.\*\* Nothing here was run against a real gateway/);
  assert.match(readme, /exact words could, in rare cases, be read this way\. It is never shown as allowed/);
  assert.match(readme, /does not say which of its requests got a status or a JSON-RPC error/);
});
