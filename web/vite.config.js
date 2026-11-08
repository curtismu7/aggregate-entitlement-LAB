import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served by its own server (npm run build, then npm start): there is no dev server and so no second port.
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", globalSetup: "./src/globalSetup.js" },
});
