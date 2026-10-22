import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { initPlatform } from "./platform.js";
import { initNativeShell, hideSplash } from "./native/shell.js";
import "./index.css";

/* Before anything renders, and before any screen can call the API.

   In a browser this does nothing whatsoever. Inside the iOS app the web
   assets are served from the bundle, so a relative `/api/…` would look for an
   API on the phone; this points those at the real one. See `platform.js` for
   why it is a boundary adapter rather than eighty-eight edited call sites. */
initPlatform();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

/* The native shell, after the render call rather than before it.

   `createRoot().render()` schedules the work; it does not finish it. Hiding
   the splash here would still be slightly early, so that waits for the frame
   after paint — the splash is configured not to hide itself precisely so
   that this can decide, and a blank web view between the splash leaving and
   the app arriving is the commonest way a Capacitor app looks broken.

   None of this runs in a browser, and all of it is allowed to fail. */
initNativeShell();
requestAnimationFrame(() => requestAnimationFrame(() => { hideSplash(); }));
