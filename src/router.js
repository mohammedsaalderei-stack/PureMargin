import { useEffect, useState } from "react";

/* URL routing.

   The app used to hold its current screen in React state alone, which meant
   every screen shared one URL: the browser's back button left the app
   entirely and no screen could be linked to. Routes now live in the hash
   (`#/pricing`, `#/app/menu`, `#/admin`) — that keeps deep links working on
   any static host, with no server rewrite to keep in sync.

   `navigate` pushes by default, so back returns to where you were; pass
   `{ replace: true }` for a correction the user never chose (an unreachable
   route being normalised, for instance) which shouldn't become a stop on the
   way back. */

const ROUTE_EVENT = "sufra:route";

export function parseHash(hash = window.location.hash) {
  const parts = String(hash).replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  return { name: parts[0] || "landing", param: parts[1] || "", path: parts.join("/") };
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#/${String(path).replace(/^\/+/, "")}`;
  if (window.location.hash === hash) return;
  /* pushState/replaceState never fire hashchange, so the app is told
     directly; back and forward still arrive as popstate. */
  window.history[replace ? "replaceState" : "pushState"](null, "", hash);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    window.addEventListener(ROUTE_EVENT, on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
      window.removeEventListener(ROUTE_EVENT, on);
    };
  }, []);
  return route;
}

/* Backspace goes back a screen, the way it does in a file browser — but only
   when the keystroke isn't editing text, where deleting a character is what
   it obviously means. */
export function useBackspaceBack() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Backspace" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "")) return;
      e.preventDefault();
      window.history.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
