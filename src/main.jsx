import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { initPlatform } from "./platform.js";
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
