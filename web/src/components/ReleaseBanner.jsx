import React from "react";
import { BANNER } from "../lib/gateway.js";
import "./ReleaseBanner.css";

// Shown on every tab and in presenter mode (it sits in the shell, outside the page, and nothing hides it). It states the
// claim label and the mode the app is in. Mock simulates the feature in this process; Real asks the operator's own gateway.
export default function ReleaseBanner({ source }) {
  const mode = source === "real" ? "Real (asks your own gateway with your agent keys)" : "Mock (simulated in this process, nothing leaves this computer)";
  return (
    <p className="release-banner" role="note" data-testid="release-banner">
      <span className="release-banner__claim">{BANNER}.</span>{" "}
      Entitled listing and the aggregate cap are a Ping release claim: Mock simulates them, and Real measures what your gateway actually does. Mode: {mode}.
    </p>
  );
}
