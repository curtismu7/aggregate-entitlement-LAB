#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root). Format: docs/content-pack.schema.json (a copy of the ID-JAG kit's schema).
 * Glossary from content/terms.json; the one story from web/src/data/stories. Deterministic: lists sorted by id, 2-space
 * JSON, no timestamps. The git commit is recorded only when passed (--commit=<sha>).
 * Pattern from hostile-mcp scripts/build-content-pack.mjs (same author).
 *
 * Story ids: the schema requires S<2 digits>; the in-app story is MT3, published here as S01.
 * Sources: one. The only public documentation URL in the source READMEs is the MCP home page. It was not fetched while writing this pack, so its status is "not-read".
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// In-app story id -> pack story id.
const STORY_IDS = { MT3: 'S01' };

const CARDS = [
  { id: 'entitled-listing', label: 'Entitled listing and aggregate cap (Ping release claim)', description: 'A Ping release claim (2026-11-02), listing and cap measured on gateway v1.261106 (2026-11-08), per-caller entitlement UNVERIFIED on our tenant: tools a caller may not use are removed from the list and refused by name, and an aggregate policy cap is enforced twice. Mock simulates it and lets you edit the policy; Real measures your own gateway\'s aggregate apps with your agent keys.', group: 'try-it', href: '/#gateway', terms: ['entitlement-aware-discovery', 'aggregate-policy-cap', 'mcp-aggregate', 'tool-filter', 'filtered-listing-scan'] },
  { id: 'six-checks', label: 'The six checks a tool must pass', description: 'The tool exists, its member is reachable, the caller signed in to it, the ToolFilter exposes it, the member policy allows the caller, the aggregate cap allows it. The check that stopped a call is highlighted.', group: 'concept', href: '/#gateway', terms: ['tool-filter', 'aggregate-policy-cap', 'mcp-aggregate'] },
  { id: 'try-this', label: 'Try this: six guided steps', description: 'One click sets the caller, the view and the call: Guest sees one tool, the cap refuses a call, the ToolFilter refuses a call, a member used directly skips the cap, the member says no, a member goes down.', group: 'try-it', href: '/#gateway', terms: ['entitlement-aware-discovery', 'filtered-listing-scan'] },
  { id: 'scan-this-listing', label: 'Scan this listing as each caller', description: 'The scan reads the list exactly as one caller sees it. A clean result is clean for that caller only.', group: 'try-it', href: '/#gateway', terms: ['filtered-listing-scan', 'tool-poisoning', 'hidden-instruction', 'scan-report'] },
  { id: 'story-entitled-listing', label: 'Story: only what you may see', description: 'Same server, different callers: what each is shown, what is refused by name, what the cap removes, and what a scan of a filtered list cannot say.', group: 'concept', href: '/#stories', terms: ['entitlement-aware-discovery', 'aggregate-policy-cap', 'filtered-listing-scan'], story: 'S01' },
  { id: 'why-it-matters-gateway', label: 'Why it matters: MCP gateway and aggregate (Ping claims)', description: 'The Challenge, Technical and Business lines from Ping\'s H2 2026 deck, slides 36 and 37, labelled as Ping claims, UNVERIFIED on our tenant.', group: 'reference', href: '/#stories', terms: ['why-mcp-gateway', 'why-mcp-aggregate'] },
  { id: 'limits', label: 'What a scan cannot catch', description: 'Result injection, rug-pulls after the scan, unfetched content and novel phrasing.', group: 'reference', href: '/#limits', terms: ['tool-poisoning', 'scan-report'] },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = fs.readdirSync(path.join(ROOT, 'web/src/data/stories')).filter((f) => f.endsWith('.json')).map((f) => ({ f, s: readJson(`web/src/data/stories/${f}`) }))
    .map(({ f, s }) => {
      if (!STORY_IDS[s.id]) throw new Error(`story ${s.id} has no pack id in STORY_IDS`);
      return { id: STORY_IDS[s.id], title: s.title.replace(/\{\{[^}]+\}\}/g, (m) => ({ '{{ada}}': 'An operator', '{{vocab.server}}': 'a server', '{{vocab.serverShort}}': 'The server' }[m] || 'the')), say: s.say, file: `web/src/data/stories/${f}` };
    }).sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'aggregate-entitlement',
    title: 'Aggregate entitlement lab',
    version: pkg.version,
    ...(commit ? { source: { repo: 'aggregate-entitlement-LAB', commit } } : {}),
    demo: { id: 'aggregate-entitlement', name: 'Aggregate entitlement lab', catalog: 'D125', baseUrl: 'http://localhost:7802', doctor: '/api/health', tags: ['mcp', 'mcp-aggregate', 'entitlement', 'agent-gateway'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [{ id: 'mcp-home', title: 'Model Context Protocol', url: 'https://modelcontextprotocol.io', kind: 'website', use: 'Named as the MCP home page in the README of mcp-tools-LAB, which this lab was forked from. Not quoted here.', status: 'not-read', checked: '2026-10-21' }],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'gateway', label: 'Entitled listing and aggregate cap (Ping release claim)', href: '/#gateway' }],
    stories,
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}
