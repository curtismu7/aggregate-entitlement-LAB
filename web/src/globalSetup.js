// Vitest global setup: runs in Node (not jsdom). Starts the real server app on an ephemeral loopback port so the page
// tests for the simulated gateway can call the real engine. The env is empty, so no settings file is read and Real is off.
import { createApp } from "../../server/src/app.js";
import { startHttpServer } from "../../server/src/index.js";
import { createRunLog } from "../../server/src/runObs.js";

export default async function setup(project) {
  const srv = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ env: {}, runLog: createRunLog({ write: () => {} }) }) }); // no stdout line per decision in the test log
  project.provide("gatewayOrigin", `http://127.0.0.1:${srv.port}`);
  return async () => { await srv.close(); };
}
