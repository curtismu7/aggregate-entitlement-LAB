import React, { useCallback, useEffect, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import { get, post } from "./lib/api.js";
import Stories from "./pages/Stories.jsx";
import Limits from "./pages/Limits.jsx";
import Gateway from "./pages/Gateway.jsx";
import ReleaseBanner from "./components/ReleaseBanner.jsx";
import { useGateway } from "./lib/gateway.js";
import { PresentBar, PresentProvider, PresentToggle } from "./present/PresentMode.jsx";

const PAGES = [["gateway", "Entitled listing"], ["stories", "Stories"], ["limits", "Limits"]];
const store = {
  read(k) { try { return localStorage.getItem(k); } catch { return null; } },
  write(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};

function Shell() {
  const [page, setPage] = useState(() => (PAGES.some(([id]) => id === window.location.hash.slice(1)) ? window.location.hash.slice(1) : "gateway"));
  const [theme, setTheme] = useState(() => store.read("aggregate-entitlement-theme") || "system");
  const [modeInfo, setModeInfo] = useState(null);
  const [modeNote, setModeNote] = useState("");
  const gw = useGateway(); // the simulated gateway: lives here so Reset can restore it with the diagram

  // Rule 19: the header toggle asks the server (server-side mode), then every page reads the new mode.
  useEffect(() => { get("/api/info").then((r) => setModeInfo(r.data)).catch(() => {}); }, []);
  const chooseMode = useCallback((source) => {
    if (source === (modeInfo?.source || "mock")) return;
    post("/api/mode", { source }).then((r) => {
      if (r.ok && r.data?.source) { setModeInfo(r.data); setModeNote(""); }
      else setModeNote(r.data?.message || `the switch was refused (HTTP ${r.status})`);
    }).catch((e) => setModeNote(e.message));
  }, [modeInfo]);
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
    store.write("aggregate-entitlement-theme", theme);
  }, [theme]);
  useEffect(() => { window.location.hash = page; }, [page]);
  useEffect(() => { document.title = `${PAGES.find(([id]) => id === page)?.[1] || "Aggregate entitlement"} · Aggregate entitlement lab`; }, [page]);

  const source = modeInfo?.source || "mock";
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="top">
        <h1>Aggregate entitlement lab</h1>
        <ShelfLink />
        <div className="seg" role="group" aria-label="Mock or Real" data-testid="mode-toggle">
          <button type="button" aria-pressed={source !== "real"} onClick={() => chooseMode("mock")} data-testid="mode-mock">Mock</button>
          <button type="button" aria-pressed={source === "real"} aria-disabled={modeInfo?.realAvailable === false || undefined}
            title={modeInfo?.realAvailable === false && modeInfo?.realReason ? modeInfo.realReason : undefined}
            onClick={() => chooseMode("real")} data-testid="mode-real">Real</button>
        </div>
        <nav aria-label="Pages">
          {PAGES.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={page === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPage(id); }}>{label}</a>
          ))}
        </nav>
        <PresentToggle />
        <label className="theme">Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </label>
      </header>
      <PresentBar />
      <ReleaseBanner source={source} />
      {modeNote && <p className="notice" role="status" data-testid="mode-note">{modeNote}</p>}
      <main className="page" id="main" tabIndex={-1}>
        {page === "gateway" && <Gateway gw={gw} modeSource={source} theme={theme} />}
        {page === "stories" && <Stories />}
        {page === "limits" && <Limits />}
      </main>
    </>
  );
}

export default function App() {
  return <PresentProvider><Shell /></PresentProvider>;
}
