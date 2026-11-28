import React, { useCallback, useEffect, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import { get, post } from "./lib/api.js";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import HelpDialog from "./help-dialog/HelpDialog.jsx";
import { HELP_SECTIONS } from "./helpContent";
import { pageTalkSteps } from "./story/StoryPanel";
import Stories from "./pages/Stories.jsx";
import Limits from "./pages/Limits.jsx";
import Gateway from "./pages/Gateway.jsx";
import ReleaseBanner from "./components/ReleaseBanner.jsx";
import { useGateway } from "./lib/gateway.js";
import { PresentBar, PresentProvider, usePresent } from "./present/PresentMode.jsx";

const PAGES = [["gateway", "Entitled listing"], ["stories", "Stories"], ["limits", "Limits"]];
const store = {
  read(k) { try { return localStorage.getItem(k); } catch { return null; } },
  write(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};

function Shell() {
  const present = usePresent();
  const [talkOpen, setTalkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [page, setPage] = useState(() => (PAGES.some(([id]) => id === window.location.hash.slice(1)) ? window.location.hash.slice(1) : "gateway"));
  const [theme, setTheme] = useState(() => store.read("aggregate-entitlement-theme") || "system");
  const [fontStep, setFontStep] = useState(() => { const f = store.read("aggregate-entitlement.font"); return ["S", "M", "L"].includes(f) ? f : "M"; });
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
  useEffect(() => {
    applyFontSize(fontStep);
    store.write("aggregate-entitlement.font", fontStep);
  }, [fontStep]);
  useEffect(() => { window.location.hash = page; }, [page]);
  useEffect(() => { document.title = `${PAGES.find(([id]) => id === page)?.[1] || "Aggregate entitlement"} · Aggregate entitlement lab`; }, [page]);

  const source = modeInfo?.source || "mock";
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">AE</span>
          <h1>Aggregate entitlement lab</h1>
          <span className={`shell-badge${source === "real" ? " shell-badge--real" : ""}`} data-testid="mode-badge">{source === "real" ? "Real" : "Mock"}</span>
        </span>
        <nav className="shell-nav" aria-label="Pages">
          {PAGES.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={page === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); setPage(id); }}>{label}</a>
          ))}
        </nav>
        <TopMenu
          mode={{ value: source === "real" ? "real" : "mock", onChange: chooseMode, realAvailable: modeInfo?.realAvailable !== false, realHint: modeInfo?.realReason || undefined }}
          theme={{ value: theme === "system" ? "auto" : theme, onChange: (t) => setTheme(t === "auto" ? "system" : t) }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: Boolean(present?.present), onToggle: () => present?.set(!present?.present), label: "Present" }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          help={{ onClick: () => setHelpOpen(true), title: "What this lab is, and what is simulated" }}
          version={modeInfo?.version || null}
          onReset={gw.reset}
        >
          <ShelfLink />
          <VerifyMark id="aggregate-entitlement-lab" />
        </TopMenu>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        <ReleaseBanner source={source} />
        {modeNote && <p className="notice" role="status" data-testid="mode-note">{modeNote}</p>}
        <PresentBar />
        {page === "gateway" && <Gateway gw={gw} modeSource={source} theme={theme} />}
        {page === "stories" && <Stories />}
        {page === "limits" && <Limits />}
      </main>
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={pageTalkSteps()} />
      <HelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} sections={HELP_SECTIONS} docsUrl="https://github.com/curtismu7/aggregate-entitlement-LAB#readme" />

    </>
  );
}

export default function App() {
  return <PresentProvider><Shell /></PresentProvider>;
}
