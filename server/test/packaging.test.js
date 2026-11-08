// Packaging pins: the port is published on loopback only, the image is Node 26 and non-root, the port matches the registry
// entry, and the shelf entry's compose path is relative.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const PORT = '7802';

test('docker-compose.yml publishes only on 127.0.0.1, on the registered port', () => {
  const ports = [...read('docker-compose.yml').matchAll(/^\s+-\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.equal(ports.length, 1, 'one published port');
  assert.match(ports[0], new RegExp(`^127\\.0\\.0\\.1:\\$\\{HOST_PORT:-${PORT}\\}:${PORT}$`));
  assert.doesNotMatch(read('docker-compose.yml'), /network_mode|docker\.sock|^\s+volumes:/m);
});

test('the image is Node 26, runs as a non-root user and exposes the registered port', () => {
  const d = read('Dockerfile');
  assert.match(d, /^FROM node:26-alpine AS build/m);
  assert.match(d, /^USER node$/m);
  assert.match(d, new RegExp(`^EXPOSE ${PORT}$`, 'm'));
  assert.match(read('docker-compose.yml'), /LAB_ALLOWED_HOSTS/);
});

test('the shelf entry is portable and points at this port', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'aggregate-entitlement-lab');
  assert.equal(e.url, `http://localhost:${PORT}`);
  assert.equal(e.healthPath, '/api/health');
  assert.match(e.composeFile, /^aggregate-entitlement-LAB\/docker-compose\.yml$/);
  assert.ok(!e.composeFile.startsWith('/'));
  assert.deepEqual(e.pingProducts, []);
});

test('the repo needs Node 26 and carries no unrelated identity', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=26');
  assert.equal(pkg.name, 'aggregate-entitlement');
});

test('no source or doc still carries the settings or identity of the app this was forked from', () => {
  const walk = (dir) => fs.readdirSync(new URL(`../../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === 'dist' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));
  const old = /MCP_TOOLS_|MCPTOOLS_|\.mcp-tools/;
  const hits = ['server/src', 'web/src', 'docs', 'scripts'].flatMap(walk).filter((f) => !f.endsWith('packaging.test.js') && old.test(read(f)));
  assert.deepEqual(hits, []);
});

test('compose passes a usable SHELF_URL so the header Shelf button shows in Docker', () => {
  assert.match(read('docker-compose.yml'), /SHELF_URL:\s*\$\{SHELF_URL:-http:\/\/127\.0\.0\.1:4400\}/);
});
