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
    await StatusBar.setBackgroundColor({ color: BACKGROUND });
    await StatusBar.setOverlaysWebView({ overlay: false });
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

/* Everything, once. Safe to call in a browser, where it does nothing. */
export async function initNativeShell({ onResume } = {}, scope = globalThis) {
  if (!isNativePlatform(scope)) return { native: false };

  document.documentElement.classList.add("is-native");

  await Promise.allSettled([
    setUpStatusBar(),
    setUpKeyboard(),
    setUpBackButton(),
    setUpResume(onResume),
  ]);

  return { native: true };
}
