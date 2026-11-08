# Security rules and the tests that enforce them

This lab can ask a gateway the operator names (Real), so each rule below has a test. Server tests are `node --test` files in `server/test/`; web tests are vitest files under `web/src/`. `npm test` runs both.

| Rule | Where | Test |
| --- | --- | --- |
| Binds loopback unless `AGG_ENT_BIND` is set | `server/src/security.js` | `security.test.js` "bind"; `doctor.test.js` |
| Rejects a non-loopback `Host` header (DNS rebinding) unless it is on `LAB_ALLOWED_HOSTS` | `hostCheck` | `security.test.js` "Host check"; `gateway.api.test.js` "the gateway routes need a same-origin write, and the host check applies" |
| Any state-changing endpoint is same-origin only (`Origin` equals `Host`) | `sameOriginWrites` | `security.test.js`; `gateway.api.test.js`; `gateway.real.test.js` "rule 19" |
| An agent key is never returned, logged or shown, even when the gateway echoes it in a refusal | `gateway/real.js` (`scrub`, `scrubJson`), `redact.js` | `gateway.real.test.js`: a stub gateway copies the key into its refusal text; every response is searched for the key |
| Real only lists tools, or sends a name that is NOT in the caller's listing, with no arguments and an explicit confirm; a listed tool is never called from this lab | `gateway/routes.js` | `gateway.real.test.js` "a listed tool is never sent from this page" |
| Real asks only the gateway in the settings (https, or http on loopback), only apps named in the settings, only callers named by a key | `gateway/real.js` (`realConfig`), `routes.js` | `gateway.real.test.js` "realConfig and readRefusal", "call: ... app, caller and name are checked" |
| Mock never opens a socket | `server/src/gateway/` (pure, no I/O) | `gateway.api.test.js` "netguard: every gateway route (Mock) makes zero outbound connections, DNS lookups or child processes" (guard in `server/test/netguard.js`, self-checked) |
| Gateway input is bounded and strict: unknown fields, too many items, duplicate or dangling names and prototype-looking keys are refused with a fixed message | `gateway/config.js` | `gateway.api.test.js` "hostile input: ..." ; `gateway.engine.test.js` "hostile names" |
| A typed credential is refused in every Mock field a sender can type and never echoed. Detection is a best-effort denylist of shapes; a secret in a shape it does not know passes: type no secret at all | `gateway/config.js` (`credentialLike`) | `gateway.credentials.test.js`, `gateway.config.test.js` |
| A hidden tool is refused when called by name, with the same words as an unknown one | `gateway/sim.js` | `gateway.engine.test.js` |
| Server redirects are never followed (a key must not travel) | `mcp/http.js` | the Real client sets `redirect: 'manual'`; `gateway.real.test.js` |
| Everything from a gateway renders as inert text; strict CSP and hardening headers | `web/src/lib/Untrusted.jsx`, `app.js` | web `untrusted.test.jsx` |
| Real is refused with 409 and the how-to when it is not configured; the default mode is Real only if it is configured | `app.js` | `gateway.real.test.js` "not configured", "rule 19" |
| The container publishes its port on `127.0.0.1` only and runs as non-root | `docker-compose.yml`, `Dockerfile` | `packaging.test.js` |
| The scan rules are heuristics | `scanner/` | `scanner.test.js`, `scanner.legacy.test.js`; [scan-rules.md](scan-rules.md) says what each one misses |

Known edges, stated plainly:

- Real sends the agent key to the gateway URL in the settings. That is its job; it is not an SSRF-hardened proxy, which is why it binds loopback, checks `Host` and `Origin`, and only reads the gateway URL from settings, never from a request.
- A key is held in this process's environment (or read from `~/Development/.env`) so calls can authenticate. It is as safe as your account. A key shorter than four characters is not redacted.
- If the gateway wrongly allows a hidden name, that tool runs once with no arguments. The confirm box says so.
- Which of the six checks a refusal matches is our reading of the gateway's words; the gateway does not name the check.
