import { Component } from "react";
import { LIGHT, DARK } from "./theme.jsx";
import { STRINGS } from "./i18n.jsx";

/* A class component can't use hooks, so it reads the language off the
   document element that LanguageProvider already keeps in sync. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Screen crashed:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    /* A class component can't call hooks, so it reads both the language and
       the theme off the document element that the providers keep in sync. */
    const C = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? DARK : LIGHT;
    const lang = typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar" : "en";
    const t = STRINGS[lang];

    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md">
          <p className="display font-bold text-lg mb-2">{t.error.screenTitle}</p>
          <p className="text-sm mb-4" style={{ color: C.slate }}>{t.error.screenBody}</p>
          <pre
            dir="ltr"
            className="data text-xs p-3 rounded-lg overflow-auto whitespace-pre-wrap mb-4"
            style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
          >
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg  text-sm font-semibold"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {t.common.tryAgain}
          </button>
        </div>
      </div>
    );
  }
}
