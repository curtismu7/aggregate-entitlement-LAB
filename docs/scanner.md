# The scanner

On the Entitled listing page, **Scan this listing** runs the metadata scanner over the list exactly as the chosen caller sees it. A scan reads what a server says about its tools, before an agent ingests it, and reports what looks like poison. **It reports; it never blocks**, never calls a tool and never changes a server's data.

## Rules

Each rule has a stable id and one fixed severity (`info`, `warn`, `high`). The table is `server/src/scanner/rules.js`, also served by `GET /api/rules` and shown on the Limits page; [scan-rules.md](scan-rules.md) says what each rule looks at and what slips past it. Ids never change meaning.

## Evidence

Every finding names the `field` (a path such as `inputSchema.properties.callback_url.default`), `start` and `end` (UTF-16 code-unit offsets into the original string) and an excerpt with invisible characters shown as `[U+XXXX]`.

## Budgets

Hostile input ends in a `MT-LM-001` finding, not a crash. Defaults (`DEFAULT_BUDGET` in `engine.js`): depth 32, 20,000 values, 1,048,576 characters in total, 20,000 characters per string, 500 findings.

## The report: scan-report/1

`buildReport` produces [scan-report/1](scan-report.schema.json): `scannedAt`, `scanner` (with `enforcement: "none"`), `source`, `input` counts, `summary`, `findings` (worst first), the `rules` that ran and the `limits` below.

## What a metadata scan does NOT catch

- **Result-based injection.** A tool with clean metadata whose call result carries the instruction. The scan never calls a tool.
- **Rug-pulls after the scan.** A server can serve a clean list now and a poisoned one later. A scan is one list at one moment.
- **Content you did not fetch.** This lab scans the tool list only.
- **Novel phrasing**, another language, or an instruction split across fields. The rules are heuristics; an unusually worded legitimate tool can also trip one.
- **A filtered list.** A scan of an entitlement-filtered list covers only what that caller sees; a clean result is clean for that caller only.
- **Whether a clean tool should be allowed at all**, or what it does when called. A clean scan is not proof of safety.
