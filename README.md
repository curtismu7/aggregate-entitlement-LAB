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
6. **What Privilege did**: under the call result (Mock) or the Real controls, each call to the gateway: the exact request, the exact response and the decisions in between. In Mock the lab's own simulated gateway computed the checks (marked as such); in Real the gateway reports no per-check detail, so decisions are only *inferred* from the status or *observed* in the response, and the agent key is never shown. The panel is the shared `GatewayTrace`, vendored byte for byte and pinned by a hash.

7. **What each layer logged for this run** (rule 27): the shared run-observability panel under the trace, for the one request the page just made. See below.

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

## What each layer logged for this run (rule 27)

Under the trace the page shows the shared run-observability panel for ONE run: the request the page just made, a `tools/list` or a `tools/call` by name (the call's record once you have called, the listing's before that). Six layers, each row with its time, an outcome and an origin tag; ids and addresses are masked. The panel is the shared one, vendored byte for byte and pinned by a hash; this lab's own mapping is the one file `server/src/runObs.js`.

| Layer | Mock | Real |
| --- | --- | --- |
| Person | `not-logged`: the lab has no sign-in | `not-logged`: the lab calls with an agent access key, not as a person |
| Agent | one `info` row: the caller asked (a simulated caller: no key is taken and there is no OBO token) | `not-logged`: the caller is an agent key, not an OBO token; the gateway's log of that key is not read |
| Authorize | `not-logged`: the lab does not call PingOne Authorize | the same |
| Privilege | the simulation's policy decisions (`allowed` or `refused`: the ToolFilter, the member's own policy, the aggregate cap), `simulated`; the lab's own policy, not PingOne Privilege | `not-logged`: Privilege's policy log is not read and the gateway reports no per-check detail |
| Agent gateway | the simulated aggregate's answer, `simulated`: a listing with tools is `allowed`; the answer to a call repeats the decision above it, so it is `info` | what the lab RECEIVED from your gateway, as `response` rows (never `logged`): a 403 `refused`; a usable tool list `allowed`; a JSON-RPC error inside a 200 or an `isError` reply `refused` only when the lab's own reading of its words matches one of the four refusal checks (the row says so), otherwise `info` (the tool's own outcome, or a fault the lab cannot tell apart from a refusal); a 401 (the agent key not accepted) `info`; an unreadable body or any other status `info`; which check a refusal matches is the lab's reading, in the row's words |
| Resource server | a row only when the configuration marks a member unreachable or needing the caller's own sign-in (`info`: a fault and a credential state are not policy decisions); the simulation has no member server and nothing is run | `not-logged`: the member servers behind the aggregate write no log this lab reads |

- **A run is one request.** Each listing and each call is its own run with its own id. The server keeps the last 12 of each kind per mode in memory (a Mock listing is recomputed on every edit, so listings and calls are counted apart, and Mock and Real apart); a run still being made is never dropped. A run id is the kind, random bits chosen when the server starts and a counter, so ids do not repeat after Reset or a restart (the random part is probabilistic, not a guarantee). The page asks for a run by the id its own answer carried. A request the lab did not accept (a malformed name, a credential typed into an argument) begins no run and the answer says so. The scan and the demo audit view are not gateway requests and add no row.
- **More runs than the panel shows.** The "See it drawn" diagram asks the simulation for the caller's listing too, so a page load writes two listing runs (six stdout lines); both are real requests the simulation computed, and the panel shows the page's own.
- **Time = when the lab recorded it.** In Mock the simulation answers in one instant, so the rows of one request share one time (their order is kept). In Real a row is stamped with the time of the reply (when the lab had it, not when it finished closing the session). A run that is partial (a reply that never came, or a call that was not sent because the name is in the caller's listing) says so on the page.
- **Where this lab's run leaves logs.** On the container's stdout, one line per row: `<time> aggregate-entitlement-lab decision step=... layer=... actor=<caller name> result=passed|stopped|unclear|no-reply cause=... run=<id>`. The time on the line is the row's time. A line never holds an agent key, a tool name or a gateway address.
- **Where they can stream.** Nowhere today: the family log collector (`shared/ping-log-collector`) reads a fixed list of containers and this lab's is not on it, so it would need an entry first. If it were added, the SIEM time would be Docker's wall-clock time for the line, not the time in the line.
- **What is `not-logged` today.** Authorize has no container log (and this lab does not call it); Privilege's SIEM index and console activity log are not read (this lab reads no logs, so it vendors the core only and has no run-observability environment variable); the PingOne audit reader does not exist; PingFederate's `audit.log` is not shipped (not used here); the gateway's refusal and block line shapes are unconfirmed.
- **Reset.** `POST /api/reset` (`npm run reset`) puts the mode back to its default and clears the run records. The page's own Reset button reloads the default policy and clears the Mock call; it does not call the API and keeps the records, so the Real checks on the page stay as they are.
- **Visitors.** The run records are shared by everyone who reaches the container: a record is fetched by its id, there is no list, and the last 12 per kind and mode are kept, so another visitor's burst of requests can push yours out ("no longer kept").
- **Inherited, not changed.** The gateway trace above the panel (shared `GatewayTrace`) and the Mock listing keep showing the last listing while the next one is asked for; this panel shows "Collecting this run's logs…" instead of an older record.
- **Not verified.** Nothing here was run against a real gateway: Real is owner-run and the tests use an in-process stub on loopback. The shared client does not say which of its requests got a status or a JSON-RPC error (the opening handshake or the call itself), so a row says "while the lab was opening or making" the call and never "answered tools/list" for a call that failed. The shared client also drops the error code, so a failure that carries exactly its "unreachable" or "timed out" words is read as no connection; a gateway refusal that used those exact words could, in rare cases, be read this way. It is never shown as allowed.

## Test

`npm test` runs the server (`node --test`), web (vitest), the forbidden-strings gate test and the pin tests of the vendored `GatewayTrace` and run-observability files. `npm run build`, `npm run content-pack` and `npm run doctor` are the other checks. The CI also runs the forbidden-strings gate, gitleaks and the attribution check. Run `scripts/check-ui-standard.sh` after touching the vendored stylesheet.

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
