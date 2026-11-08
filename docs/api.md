# HTTP API

Every request needs a loopback `Host` (or a name in `LAB_ALLOWED_HOSTS`). Every non-GET needs `Origin` equal to `Host`. Bodies are JSON and small. Errors are `{error, message}`; `message` never contains a key or a typed value.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | `demo-health/1`. Public, GET only, state from the doctor checks cached 60 s. |
| `GET /api/info` | `{source, realAvailable, realReason}`. Rule 19. `source` is `real` when Real is configured at start, else `mock`. |
| `POST /api/mode` | Exactly `{source: 'mock'\|'real'}`. 409 `real_not_available` with the how-to when Real is not configured. |
| `POST /api/reset` | Rule 3 Reset: the mode goes back to the default. `npm run reset` calls it. The edited policy lives in the browser. |
| `GET /api/rules` | The scan rule table and the limits list. |
| `GET /api/shelf` | The shelf URL for the header button, or null. |
| `GET /api/gateway/default` | The default simulated-gateway config, the tag vocabulary and the claim label. Ping release claim (2026-11-02), listing and cap measured on gateway v1.261106 (2026-11-08), per-caller entitlement UNVERIFIED on our tenant. |
| `POST /api/gateway/list` | `{config?, caller, view?: 'aggregate'\|'direct', member?}` returns the tools that caller sees and the member status. Hidden tools are absent and not counted. |
| `POST /api/gateway/call` | `{config?, caller, view?, member?, tool, arguments?}`. 200 for an allowed tool, 403 `tool_not_available` with the same words for a hidden or unknown one, plus a labelled demo trace. |
| `POST /api/gateway/audit` | Same body as list. Names every tool and the layer that stopped it. Demo only: a caller never sees this. |
| `POST /api/gateway/scan` | Same body as list. Scans the listing as that caller sees it; the notes say the scan covers only that. |
| `GET /api/gateway/real` | Real status: the app names and caller labels from the settings (never a key), or why Real is not configured. |
| `POST /api/gateway/real/list` | `{app, caller}`. Mode must be Real. `tools/list` on `<origin>/<app>/mcp` with that caller's key. A refusal comes back with our reading of which check it matches. |
| `POST /api/gateway/real/call` | `{app, caller, tool, confirm: true}`. Sends `tools/call` with no arguments ONLY for a name that is not in that caller's listing (409 `listed_tool` otherwise). |

The `/api/gateway/*` Mock routes are stateless and in-process; they refuse any field they do not list and never repeat a typed value (details: [entitled-listing.md](entitled-listing.md)).
