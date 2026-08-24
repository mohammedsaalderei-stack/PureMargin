import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import Landing from "./Landing.jsx";
import Login from "./Login.jsx";
import ForgotPassword from "./ForgotPassword.jsx";
import Register from "./Register.jsx";
import Pricing from "./Pricing.jsx";
import Shell from "./Shell.jsx";
import Splash from "./Splash.jsx";
import AdminPage from "./AdminPage.jsx";
import { LanguageProvider } from "./i18n.jsx";
import { ThemeProvider } from "./theme.jsx";
import { prefersReducedMotion } from "./hooks.js";
import { useRoute, navigate, useBackspaceBack } from "./router.js";

const OUT_MS = 260;

/* Public screens live at their own URL; the signed-in app is `#/app/<tab>`. */
const PUBLIC_VIEWS = ["landing", "login", "register", "forgot", "pricing"];

function Routes() {
  const [token, setToken] = useState(() => sessionStorage.getItem("sufra_token") || "");
  const [user, setUser] = useState(() => sessionStorage.getItem("sufra_user") || "");
  /* A team invitation link opens straight onto the sign-up form, carrying
     its token so registration lands the account in the inviting team. */
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get("invite") || "");

  const route = useRoute();
  useBackspaceBack();
  const setView = (next) => navigate(next === "landing" ? "" : next);

  /* An invitation link opens the sign-up form, and the admin panel keeps its
     own address (`#/admin`) with its own sign-in. */
  useEffect(() => {
    if (inviteToken && route.name === "landing") navigate("register", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adminView = route.name === "admin";
  const view = PUBLIC_VIEWS.includes(route.name) ? route.name : "landing";

  /* Carried from sign-in into the reset screen, so an address already typed
     doesn't have to be typed twice. */
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [splash, setSplash] = useState(() => !sessionStorage.getItem("sufra_seen"));
  /* Set only for the session that just registered, so the connect prompt
     appears once for a new account and not on every sign-in after. */
  const [justRegistered, setJustRegistered] = useState(false);

  /* Signing in and out replace the entire screen. Rather than cutting, the
     outgoing view is held for a beat while it recedes, then the incoming
     one settles. `phase` drives that hand-off. */
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    if (!splash) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [splash]);

  const transition = (apply) => {
    if (prefersReducedMotion()) {
      apply();
      return;
    }
    setPhase("out");
    setTimeout(() => {
      apply();
      setPhase("in");
      setTimeout(() => setPhase("idle"), 500);
    }, OUT_MS);
  };

  const signIn = (tk, name) => transition(() => {
    setToken(tk);
    setUser(name);
    navigate("app/overview");
  });

  const signOut = () => transition(() => {
    sessionStorage.removeItem("sufra_token");
    sessionStorage.removeItem("sufra_user");
    setToken("");
    setUser("");
    setView("landing");
  });

  /* A signed-in session that lands on a public address is put back on the app,
     without leaving that address behind for the back button to return to. */
  useEffect(() => {
    if (token && !adminView && route.name !== "app") navigate("app/overview", { replace: true });
  }, [token, adminView, route.name]);

  let screen;
  if (adminView) {
    screen = <AdminPage />;
  } else if (token) {
    screen = (
      <Shell
        token={token}
        user={user}
        onLogout={signOut}
        justRegistered={justRegistered}
        /* A password change or "sign out everywhere" issues a fresh token;
           without adopting it, the device that made the change would sign
           itself out. */
        onSession={(next) => {
          sessionStorage.setItem("sufra_token", next);
          setToken(next);
        }}
      />
    );
  } else if (view === "pricing") {
    screen = <Pricing onBack={() => setView("landing")} onSignIn={() => setView("login")} />;
  } else if (view === "register") {
    screen = (
      <Register
        inviteToken={inviteToken}
        onBack={() => setView("landing")}
        onSignIn={() => setView("login")}
        onRegistered={(tk, name) => {
          setJustRegistered(true);
          signIn(tk, name);
        }}
      />
    );
  } else if (view === "forgot") {
    screen = (
      <ForgotPassword
        initialIdentifier={resetIdentifier}
        onBack={() => setView("login")}
        onReset={signIn}
      />
    );
  } else if (view === "login") {
    screen = (
      <Login
        onBack={() => setView("landing")}
        onAuthed={signIn}
        onRegister={() => setView("register")}
        onForgot={(typed) => {
          setResetIdentifier(typed || "");
          setView("forgot");
        }}
      />
    );
  } else {
    screen = <Landing onSignIn={() => setView("login")} onRegister={() => setView("register")} onPricing={() => setView("pricing")} />;
  }

  const cls =
    phase === "out" ? "auth-out" : phase === "in" ? "auth-in" : token ? "" : "view-in";

  return (
    <>
      {phase !== "idle" && <div className="auth-bar" />}
      <div className={`${cls} min-h-full`} key={adminView ? "admin" : token ? "app" : view}>
        {screen}
      </div>
      {splash && (
        <Splash
          onDone={() => {
            sessionStorage.setItem("sufra_seen", "1");
            setSplash(false);
          }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <Routes />
        <Analytics />
      </LanguageProvider>
    </ThemeProvider>
  );
}
