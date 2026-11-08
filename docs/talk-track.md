# Talk track: Aggregate entitlement lab

Each `##` heading is one presenter step. A Tester-tier lab: see how an MCP aggregate lists only what each caller may use, then check your own gateway. Every product claim here is a Ping release claim (2026-11-02), UNVERIFIED on our tenant. Say that first, and point at the banner that says it on every page.

## The pitch in one line

An agent that sees a tool can try it, a prompt injection can name it, and the list tells an attacker what exists. So the gateway should show each caller only its own tools, and refuse the rest by name too.

## Read the label first

Open the Entitled listing page. The banner says Ping release claim, UNVERIFIED on our tenant, and the mode (Mock or Real). Read "What this page shows": an aggregate puts several MCP servers (members) behind one URL, tools are named `alias__tool`, and the claim is that the list is per caller.

## Try this: same gateway, different callers

Press the first "Try this" step. Guest sees one tool. Nothing in the reply says crm and bill tools exist. The bill member shows "needs the caller's own sign-in".

## Call a hidden tool by name

Press the second step. The cap refuses `crm__export_all` even though the crm member would allow Operator: the cap only takes away. The check that stopped it is highlighted in the six checks. The caller sees only "not available", the same words as for a tool that does not exist.

## A tool the aggregate never exposes, and the member's own no

Steps three and five: the ToolFilter (never exposed to anyone) and the member's own policy are two different layers, and the highlight shows which one stopped the call.

## Use the member directly

Step four. Used directly, the member lists a tool the aggregate hides: the ToolFilter and cap belong to the aggregate. That is why agents should go through it.

## A member goes down

Step six. The member is reported unreachable, not dropped: an outage must not look like "no tools here".

## Scan this listing

Scan as Guest, then as Operator. A clean scan is clean for that caller only: a tool hidden from a caller was never scanned.

## Switch to Real

Flip the header toggle to Real (owner-run: it needs your gateway URL, app names and agent keys in `~/Development/.env`). The page compares what each aggregate app lists for the same key. Pick the smallest app, click a name that is listed elsewhere but hidden here, tick the confirm box and call it: the gateway should refuse it, and the six checks show which check the refusal matches. Say that mapping is our reading of the gateway's message, not a field the gateway sends. With two keys you can show two entitlements; with one, show the apps.

## The diagram, the story, the limits

"See it drawn": Simulate walks a call through the gateway; click any box for what it prevents. The Stories page tells the arc in six steps with presenter mode (the Present button, or the p key). Close on Limits: a scan never blocks and cannot see a rug-pull.

## What this lab is not

It does not prove the release behaves this way on our tenant. Mock is our model of the claim; Real shows what one gateway does for one key. Nothing here controls calls on the wire: that is the P1 Privilege Agent App's job.
