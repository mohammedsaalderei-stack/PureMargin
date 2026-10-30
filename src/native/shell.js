/* The things an app does that a web page does not.

   Each of these is small, and together they are most of the difference
   between an app and a website someone has put a frame around — which is
   both the honest goal and, as Guideline 4.2, the review criterion.

   Every call is wrapped and every plugin dynamically imported. A failure
   here must never stop the app rendering: the worst outcome allowed is a
   status bar in the wrong colour, and the worst outcome available if this
   were unguarded is a white screen on a device nobody here can attach a
   debugger to. */

import { isNativePlatform } from "../platform.js";

const BACKGROUND = "#08060E";

/* The splash is told not to hide itself in capacitor.config.json. If it hid
   on a timer, a slow first paint would show a blank web view between the
   splash going and the app arriving — the single most common way a Capacitor
   app looks broken on launch. Instead it is dismissed here, once there is
   something behind it. */
export async function hideSplash() {
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 200 });
    return true;
  } catch {
    return false;
  }
}

async function setUpStatusBar() {
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    /* `Style.Dark` means light text on a dark bar, which reads backwards and
       is Apple's naming, not ours. The app's chrome is #08060E. */
    await StatusBar.setStyle({ style: Style.Dark });
    /* Android only. On iOS both are `call.unimplemented()` in Capacitor 6:
       the first rejected on every launch, logged an error, and skipped the
       second. The web view runs under the iOS status bar and the CSS pads
       for it (`.is-native` in index.css). */
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: BACKGROUND });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch { /* the bar keeps whatever the system gave it */ }
}

async function setUpKeyboard() {
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    /* The accessory bar is the grey strip with Previous/Next/Done. The forms
       here are single fields in sheets, where it covers content and leads
       nowhere useful. */
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
  } catch { /* the default behaviour is survivable */ }
}

/* Back gestures and the hardware back button.

   iOS has no back button, so this is mostly for the Android build that the
   same config produces. It matters here anyway: without it, Android's back
   button closes the app from any screen, including the middle of a clock-in,
   which reads as a crash. */
async function setUpBackButton() {
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) window.history.back();
      else App.exitApp();
    });
  } catch { /* the platform default applies */ }
}

/* Coming back from the background.

   A phone in a kitchen spends most of its day locked. Returning to figures
   from yesterday, with no indication they are stale, is how somebody makes a
   decision on a number that moved hours ago — so the app is told, and the
   screens that poll already know what to do with it. */
async function setUpResume(onResume) {
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("resume", () => {
      try { onResume?.(); } catch { /* a listener must not break the app */ }
      window.dispatchEvent(new CustomEvent("puremargin:resumed"));
    });
  } catch { /* no resume signal; the polling interval still refreshes */ }
}

/* Zoom, locked in the app and nowhere else.

   iOS zooms the page in when a field whose text is under 16px takes focus,
   and inside an app it never zooms back out. Most fields here are 14.9px,
   so tapping one (the POS token, a sign-in name) left the whole app wider
   than the screen for the rest of the session: margins gone, the header
   off the edge, buttons out of reach. Seen in the simulator, and reported
   from a phone as "the app is too wide".

   A web view honours `maximum-scale`, so capping it stops both that and an
   accidental pinch, which is what an app is expected to do. The website
   keeps the zoom: there a person with low vision relies on pinching, and
   a browser has its own way back out. */
export function lockedViewport(content = "") {
  const kept = String(content)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^(minimum-scale|maximum-scale|user-scalable)\s*=/i.test(part));
  return [...kept, "minimum-scale=1", "maximum-scale=1", "user-scalable=no"].join(", ");
}

function lockZoom(doc) {
  const meta = doc?.querySelector?.('meta[name="viewport"]');
  if (meta) meta.setAttribute("content", lockedViewport(meta.getAttribute("content") || ""));
}

/* Everything, once. Safe to call in a browser, where it does nothing. */
export async function initNativeShell({ onResume } = {}, scope = globalThis) {
  if (!isNativePlatform(scope)) return { native: false };

  document.documentElement.classList.add("is-native");
  lockZoom(document);

  await Promise.allSettled([
    setUpStatusBar(),
    setUpKeyboard(),
    setUpBackButton(),
    setUpResume(onResume),
  ]);

  return { native: true };
}
