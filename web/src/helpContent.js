// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: "An MCP aggregate puts several MCP servers behind one gateway URL. Without a filter, every agent that connects sees every tool from every server. This lab teaches the claim that the gateway lists only the tools each caller is entitled to, refuses a hidden tool called by name, and caps every member tool with one aggregate policy checked on the list and again at the member hop — and lets you check it."
  },
  {
    heading: "Measured vs UNVERIFIED",
    body: "The listing and cap were measured on gateway v1.261106 (2026-11-08) and access by caller was measured per aggregate (2026-11-09) — those are labelled measured. Per-tool filtering per caller is UNVERIFIED on our tenant. Mock mode simulates the claim in this process with three invented members (crm, bill, wiki) and three callers (Analyst, Operator, Guest). Nothing is a statement about product defaults or licensing."
  },
  {
    heading: "How to use the page",
    body: [
      "Pages (nav): \"Entitled listing\", \"Stories\", \"Limits\". On Entitled listing, start with the \"Try this\" card — its one-click steps (including \"Use that member directly\" and \"The member says no\") set the controls for you.",
      "Switch the view between \"Through the aggregate\" and \"One member directly\". Pick a caller, press \"Call\" to call a tool by name, or \"Scan as <caller>\" to see the metadata scanner's view of the listing.",
      "\"What Privilege did\" under the result shows the exact request, response and the six checks in between (check 1 tool exists, 2 member reachable, 3 caller signed in, 4 ToolFilter, 5 member policy, 6 aggregate cap). The header also has the Mock/Real toggle, theme, font size, Present, talk track and Reset."
    ]
  },
  {
    heading: "Mode honesty",
    body: "Mock simulates the gateway in this process; nothing leaves this computer, and the simulated checks are marked as computed by the lab's own gateway. Real asks your own gateway's MCP aggregate apps with your agent keys: it compares what each app lists for the same key and calls a hidden name to see the refusal. In Real the gateway reports no per-check detail, so decisions are only inferred from the status or observed in the response, and the agent key is never shown. If Real is not configured the server answers 409 and the button says why."
  },
  {
    heading: "What a scan cannot catch",
    body: "The Limits page lists what the metadata scanner and these checks cannot catch. The diagram (See it drawn) is a teaching drawing loaded from diagrams/gateway.json, not a capture of a real run."
  }
];
