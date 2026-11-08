# Architecture

One repo, one app: an Express server (`server/`) that serves a React + Vite page (`web/`), npm workspaces, Node ESM. One page does the teaching; Mock and Real are one toggle in the header.

```
browser (web/dist)  --same origin-->  Express (server/src/app.js)
                                        |-- security.js        loopback bind, Host check (+ LAB_ALLOWED_HOSTS), same-origin writes
                                        |-- gateway/sim.js     the simulated aggregate (Mock): pure, no I/O
                                        |-- gateway/real.js    Real: tools/list and one hidden-name call against your gateway
                                        |-- gateway/routes.js  /api/gateway/*: Mock routes, Real routes, the mode gate
                                        |-- scanner/           rule table, engine, unicode, report (Scan this listing)
                                        |-- mcp/http.js        the Streamable HTTP client Real uses (no redirects, caps)
                                        |-- redact.js          an agent key never leaves, even if the gateway echoes it
                                        |-- health.js          GET /api/health (demo-health/1) from doctor.js checks
diagrams/gateway.json  --loaded by name-->  web/src/diagrams/ (diagram-studio/1 to the ReactFlow picture)
```

## One path through it

1. **Mock.** The browser holds the policy it is editing and sends it with each request; the engine answers. Nothing is stored on the host.
2. **Real.** The header toggle calls `POST /api/mode`. Real reads `AGG_ENT_GW_*` settings (environment, `STANDALONE_ENV`, then `~/Development/.env`), lists the chosen caller's tools in each configured aggregate app and compares them. A hidden name can be called to test the refusal; the six checks highlight the one the refusal matches (our reading).
3. **Scan.** `Scan this listing` runs the scanner over the list as that caller sees it.

## The web app

Pages: Entitled listing (intro, six checks, Try this, the controls, the lists, the policy editor, glossary, the diagram), Stories (one, with presenter mode), Limits. Light and dark themes through tokens; no purple.

## Where the code came from

A fork of [mcp-tools-LAB](https://github.com/curtismu7/mcp-tools-LAB) with the connect, server, live-proxy and snapshot pages removed. The scanner, the simulated gateway and the HTTP client were written there and are copied here.
