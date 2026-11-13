# Aggregate entitlement LAB

Tier: Tester

Repo: https://github.com/curtismu7/aggregate-entitlement-LAB

An MCP aggregate puts several MCP servers behind one gateway URL. Without a filter, every agent that connects sees every tool from every server. **Ping release claim (2026-11-02), listing and cap measured on gateway v1.261106 (2026-11-08), access by caller measured per aggregate (2026-11-09), per-tool filtering per caller UNVERIFIED on our tenant:** the gateway lists only the tools each caller is entitled to, refuses a hidden tool when it is called by name, and caps every member tool with one aggregate policy that is checked on the list and again at the member hop. This lab teaches that on one page, and lets you check it.

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

---

## If the Privilege desktop agent shows "unregistered"

The PingOne Privilege **desktop app** (the one serving the local console at
`https://local.procyon.ai:8643`) stays registered with the Ping cloud through a background
agent (`ping-helper`). When that agent's device record is deleted or unapproved on the cloud
side, every Privilege app on this machine loses Real mode: the local console stops serving,
connections time out, and the desktop app shows the agent as **unregistered**.

### How to tell this is what happened

1. **The desktop app says the agent is unregistered** (banner or the agent status panel), or its
   diagnostics print `✖ Found N errors` with `Device … not found`.
2. **The local console is down with it**: `https://local.procyon.ai:8643` does not answer
   (connection refused / timeout) even though the PingOne Privilege app is running.
3. **The agent log loops on one error.** Check `/Library/Logs/Procyon/procyon-agent.log`:

   ```
   Error getting the device: HTTP error: 500 Internal Server Error
   Body: { "error": "Device <base64-id> not found", "code": 2, ... }
   ```

   repeated every ~2 seconds. That single line is the tell: the agent is asking the cloud
   about a device record the cloud no longer has. (A one-off is harmless — it is the endless
   repetition that means unregistered.)

### Why it happens

- The cloud side **deletes or disables the device record** (an admin action in the console, a
  tenant sync, or a guard tripping after network churn). The agent cannot re-create it by
  itself: it re-registers only on an enable/disable cycle, and re-registration **waits for a
  human to approve the new device** in the console.
- Network/VPN blips to `privilege.pingone.com` (`lookup … no such host` in the same log) force
  re-registrations and can churn the device identity, making the window for this bigger.

### How to fix it

1. Open the **PingOne Privilege** desktop app and make sure it is running.
2. Sign in to the **cloud console**: `https://console.pingone.com/?env=<your-privilege-env-id>`
   → launch **PingOne Privilege** → open the **Devices** page.
3. Find this machine's device (`DeviceName: mac-…`, type MAC). It is either:
   - **pending approval** — click **Approve** (the agent's certificate request is waiting;
     this is the usual state after a delete), or
   - **missing entirely** — in the desktop app toggle the agent **off and on** (or quit and
     reopen the app) so it mints a fresh certificate request, then approve it in the console.
4. The agent picks up the approval within seconds (watch
   `/Library/Logs/Procyon/procyon-agent.log` for `Device registered with controller`), and the
   local console at `local.procyon.ai:8643` starts serving again. Real mode in this app works
   immediately after — no restart of the app needed.

### If it comes back

The device being deleted repeatedly is a **console-side action** (admin, sync sweep, or a
server-side guard after repeated network drops). Note the times from
`grep "Delete request recieved" /Library/Logs/Procyon/procyon-agent*.log` and raise it with
 whoever administers the Privilege tenant — re-approving treats the symptom; the deletes have
 to stop for it to stay fixed.
