# CLAUDE.md: Aggregate entitlement lab

Tier: Tester. See how an MCP aggregate lists only the tools each caller may use and refuses the rest by name: the six checks, guided steps, a diagram. **Mock** simulates the Ping release claim (2026-11-02, UNVERIFIED on our tenant); **Real** measures your own gateway's aggregate apps with your agent keys. Repo: https://github.com/curtismu7/aggregate-entitlement-LAB, a fork of curtismu7/mcp-tools-LAB (its Entitled listing page). Read `README.md` and `docs/security.md` first; the rulebook is `~/Development/STANDALONE-RULES.md` (skill `standalone-demo`).

## Run and test
- Needs Node 26 or newer. `npm install`, `npm run doctor`, `npm test` (server `node:test`, web vitest, the forbidden-strings gate test), `npm run build`, then `npm start` (`127.0.0.1:7802`, `PORT` to change; there is no dev server, so no second port). Docker: `HOST_PORT=7802 docker compose up --build -d` publishes `127.0.0.1` only. Run suites on the Air (`air-test`), not on this Mac.
- `GET /api/health` answers `demo-health/1` for the shelf.

## Rules that bite (each has a test; do not weaken)
- Binds `127.0.0.1` (`AGG_ENT_BIND` opts in); a loopback `Host` (or `LAB_ALLOWED_HOSTS`) and a same-origin `Origin` on every write. An agent key is never returned, logged or shown; every gateway message is scrubbed of all keys.
- Real (`server/src/gateway/real.js`): settings `AGG_ENT_GW_URL`, `AGG_ENT_GW_APPS`, `AGG_ENT_GW_KEY_<NAME>` from the environment, `STANDALONE_ENV` or `~/Development/.env`. It lists tools, and calls ONLY a name that is not in the caller's listing, with no arguments and an explicit confirm. A listed tool is never called from here. Which of the six checks a refusal matches is our reading; say so.
- Rule 19: `POST /api/mode` takes exactly `{source}`; `GET /api/info` answers `{source, realAvailable, realReason}`; Real not configured is 409 with the how-to and an aria-disabled button with that tooltip; the default is Real only when it is configured. There is no hosted mode.
- The simulated gateway's credential check (`server/src/gateway/`) must never echo a submitted credential; a change there needs the documented limits in `docs/security.md` kept true.
- The diagram is data: `diagrams/gateway.json` (diagram-studio/1) loaded by name; do not hand-build nodes or edges.
- UI: the vendored `web/src/standalone-ui.css` must stay byte-identical to `~/Development/AI-DEMO-Standalone/shared/standalone-ui.css` (`scripts/check-ui-standard.sh`); no local colour literals, no `prefers-color-scheme` outside it, no `!important`. Run `check-css.sh` and `check-drift.sh` from the parent repo before a PR.
- Product claims about the Ping release are simulated and UNVERIFIED on our tenant; say so. Never say "door" (say P1 Privilege Agent App).
- The forbidden-strings gate (`npm run check:forbidden`, CI job `forbidden-strings`, secret `FORBIDDEN_STRINGS`) prints counts only. CI is GitHub-hosted, Node 26 only. Docker is OrbStack, never Docker Desktop.
- No AI attribution anywhere (owner, 2026-11-07): no Co-Authored-By trailer and no "Generated with" line in commits, PR bodies or files; CI runs `scripts/check-no-ai-attribution.sh`.

## Shelf
`docs/shelf-entry.json` registers the app (id `aggregate-entitlement-lab`, port 7802, tag `mcp`). Registry: `demo-shelf-LAB/data/demos.json`.
