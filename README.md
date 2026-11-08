# Aggregate entitlement LAB

Tier: Tester

Repo: https://github.com/curtismu7/aggregate-entitlement-LAB

An MCP aggregate puts several MCP servers behind one gateway URL. Without a filter, every agent that connects sees every tool from every server. **Ping release claim (2026-11-02), listing and cap measured on gateway v1.261106 (2026-11-08), per-caller entitlement UNVERIFIED on our tenant:** the gateway lists only the tools each caller is entitled to, refuses a hidden tool when it is called by name, and caps every member tool with one aggregate policy that is checked on the list and again at the member hop. This lab teaches that on one page, and lets you check it.

- **Mock** simulates the claim in this process (nothing leaves your computer). Three invented members (crm, bill, wiki) and three callers (Analyst, Operator, Guest); edit the member policy, the ToolFilter and the aggregate cap and watch the lists change.
- **Real** (header toggle) asks your own gateway's MCP aggregate apps with your agent keys: it compares what each app lists for the same key, and calls a hidden name to see the gateway refuse it. It never calls a tool the key can see.
- The header Mock / Real toggle works on the page without a restart. If Real is not configured the button says why and the server answers 409.

## What is on the page

1. **What this page shows**: what an aggregate is, the problem and the claim, and which mode you are in.
2. **The six checks, in order**: the tool exists, its member is reachable, the caller signed in to the member, the aggregate's ToolFilter exposes it, the member's own policy allows the caller, the aggregate cap allows it. The check that stopped your last call is highlighted.
3. **Try this**: six one-click steps (Mock) or four steps for your gateway (Real).
4. The controls, the listing, **Call a tool by name**, **Scan this listing** (the metadata scanner, as that caller sees the list), the audit view, the policy editor, where each name comes from.
5. **Words on this page** (glossary) and **See it drawn**: a ReactFlow diagram loaded from `diagrams/gateway.json` (movable boxes, Simulate, Reset diagram, speed).

Also: Stories (one story, with presenter mode, the Present button or the p key) and Limits (what a scan cannot catch). A banner on every page and in presenter mode says what is simulated.

## Run it

Run from a clone of https://github.com/curtismu7/aggregate-entitlement-LAB (Node 26 or newer):

```
npm install
npm run doctor
npm run build
npm start          # http://127.0.0.1:7802
```

`PORT` changes the port. There is no dev server (so no second port): rebuild with `npm run build` after a web change.

Docker (OrbStack):

```
HOST_PORT=7802 docker compose up --build -d     # http://127.0.0.1:7802 (published on loopback only)
```

Reached by domain through the family's lab proxy: the container accepts the names in `LAB_ALLOWED_HOSTS` (the default is set in `docker-compose.yml`). `GET /api/health` answers `demo-health/1` for the shelf.

### What to do if the port is taken

The lab uses one port, 7802, registered in the demo shelf's registry. If something else holds it, `npm run doctor` says so; stop that process, or run on another port with `PORT=<free port> npm start` (Docker: `HOST_PORT=<free port> docker compose up --build -d`). Do not pick a port another lab uses: `npm run ports` in demo-shelf-LAB lists them.

### Real mode settings

Read from the process environment, then `STANDALONE_ENV`, then `~/Development/.env`:

| Name | What |
| --- | --- |
| `AGG_ENT_GW_URL` | The gateway origin (https, or http on loopback). Each app is at `<origin>/<app>/mcp`. |
| `AGG_ENT_GW_APPS` | Comma-separated MCP aggregate app names to compare. |
| `AGG_ENT_GW_VERSION` | Optional label for the gateway image you are measuring, such as `v1.261106`. The gateway does not report it over MCP, so this is what you say it is; the Real tab shows it. |
| `AGG_ENT_GW_KEY_<NAME>` | One agent access key per caller. `NAME` becomes the caller's label. Write-only: never returned, shown or logged. |

For Docker, put the same names in the environment of `docker compose` (the compose file passes `AGG_ENT_GW_URL`, `AGG_ENT_GW_APPS`, `AGG_ENT_GW_VERSION` and the keys `_ANALYST`, `_OPERATOR`, `_GUEST` and `_LAB_AGENT`). Real is owner-run: agents use the Mock.

## Test

`npm test` runs the server (`node --test`), web (vitest) and forbidden-strings gate tests. `npm run build`, `npm run content-pack` and `npm run doctor` are the other checks. The CI also runs the forbidden-strings gate, gitleaks and the attribution check. Run `scripts/check-ui-standard.sh` after touching the vendored stylesheet.

## Security rules

See [docs/security.md](docs/security.md): loopback only, Host and Origin checks, an agent key never leaves the server, Real only sends a name that is not in the listing and only after a confirm, Mock opens no socket, hostile input is bounded.

## Docs

- [docs/entitled-listing.md](docs/entitled-listing.md): the claim, what is simulated, how every name is tagged, the talk track
- [docs/talk-track.md](docs/talk-track.md): the presenter steps
- [docs/api.md](docs/api.md), [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md)
- [docs/scanner.md](docs/scanner.md), [docs/scan-rules.md](docs/scan-rules.md), [docs/scan-report.schema.json](docs/scan-report.schema.json)
- `docs/shelf-entry.json` registers the app on the demo shelf; `content-pack.json` is its Learning Hub pack.

## Where the code came from

A **fork of [curtismu7/mcp-tools-LAB](https://github.com/curtismu7/mcp-tools-LAB)** (MIT), taken from its Entitled listing page. What changed: the Connect, Server, Live proxy and Scan-a-snapshot pages, connection storage, stdio, PingOne sign-in, saved inputs, flags and the review brief were removed; the Entitled listing page gained the intro, the six checks, guided steps, glossary and a Real mode; the diagram became diagram-studio data loaded by name; the settings were renamed `AGG_ENT_*`; the app has its own id, port (7802), shelf entry and content pack.
