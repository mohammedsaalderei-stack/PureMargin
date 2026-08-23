import { useEffect, useRef, useState } from "react";
import {
  MessageSquare, BarChart3, LineChart, ArrowRight, Check,
  Menu, X, Mail, Phone, Instagram, ShieldCheck, BookOpen, Gauge,
} from "lucide-react";
import { useC } from "./theme.jsx";
import NeonMark from "./NeonMark.jsx";
import { contactRows, hasContact } from "./contact.js";
import { useLang } from "./i18n.jsx";
import { useReveal, prefersReducedMotion } from "./hooks.js";
import { DirhamMark } from "./Dirham.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import CoreDiagram from "./landing/CoreDiagram.jsx";
import { DEMOS } from "./landing/Demos.jsx";
import SectionRail from "./landing/SectionRail.jsx";
import "./landing-glass.css";

function Section({ eyebrow, title, lead, children, id, accent }) {
  const C = useC();
  const [ref, shown] = useReveal();
  return (
    <section id={id} ref={ref} className="px-6 md:px-10 lg:px-16 py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className={shown ? "rise" : "opacity-0"}>
          {eyebrow && (
            <span className="eyebrow-chip data text-[11px] uppercase tracking-[0.18em]" style={{ color: accent || C.iris }}>
              {eyebrow}
            </span>
          )}
          <h2 className="display text-3xl md:text-4xl lg:text-5xl font-extrabold max-w-3xl leading-[1.15] mt-4 grad-text">
            {title}
          </h2>
          {lead && (
            <p className="mt-4 text-base md:text-lg max-w-2xl" style={{ color: C.slate }}>
              {lead}
            </p>
          )}
        </div>
        <div
          className={shown ? "rise mt-10 md:mt-14" : "opacity-0 mt-10 md:mt-14"}
          style={{ animationDelay: "80ms" }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

/* The hero device: a receipt that prints line by line, then resolves into a
   plain-language answer — the product's premise as one motion. */
function TicketDemo() {
  const C = useC();
  const { t } = useLang();
  const lines = t.hero.lines;
  const instant = prefersReducedMotion();

  const [printed, setPrinted] = useState(instant ? lines.length : 0);
  const [total, setTotal] = useState(instant);
  const [typed, setTyped] = useState(instant ? t.hero.answer.length : 0);

  useEffect(() => {
    if (instant) return;
    setPrinted(0);
    setTotal(false);
    setTyped(0);
  }, [t.hero.answer, instant]);

  useEffect(() => {
    if (instant || printed >= lines.length) return;
    const id = setTimeout(() => setPrinted((n) => n + 1), 520);
    return () => clearTimeout(id);
  }, [printed, lines.length, instant]);

  useEffect(() => {
    if (instant || printed < lines.length || total) return;
    const id = setTimeout(() => setTotal(true), 480);
    return () => clearTimeout(id);
  }, [printed, lines.length, total, instant]);

  useEffect(() => {
    if (instant || !total || typed >= t.hero.answer.length) return;
    const id = setTimeout(() => setTyped((n) => Math.min(n + 2, t.hero.answer.length)), 18);
    return () => clearTimeout(id);
  }, [total, typed, t.hero.answer, instant]);

  const answering = total;
  const typing = answering && typed < t.hero.answer.length;

  return (
    <div className="w-full max-w-sm mx-auto lg:mx-0">
      <div className="ticket glass bracket p-5">
        <div className="flex items-baseline justify-between mb-1 pt-2">
          <span className="display font-bold text-sm">{t.hero.ticketTable}</span>
          <span className="data text-xs" style={{ color: C.slate }} dir="ltr">#4471</span>
        </div>
        <div className="data text-xs mb-4" style={{ color: C.slate }}>{t.hero.ticketMeta}</div>

        <div style={{ minHeight: lines.length * 30 }}>
          {lines.map(([name, amt], i) => (
            <div
              key={name}
              className="flex justify-between py-1.5 text-sm"
              style={{
                opacity: i < printed ? 1 : 0,
                transform: i < printed ? "none" : "translateY(-6px)",
                transition: "opacity .3s ease, transform .3s ease",
              }}
            >
              <span>{name}</span>
              <span className="data" style={{ color: C.slate }} dir="ltr">{amt}</span>
            </div>
          ))}
        </div>

        <div
          className="rule-dashed mt-3 pt-3 flex justify-between"
          style={{ opacity: total ? 1 : 0, transition: "opacity .4s ease" }}
        >
          <span className="font-semibold text-sm">{t.hero.ticketTotal}</span>
          <span className="data font-semibold inline-flex items-baseline gap-1" dir="ltr">
            <DirhamMark /> 270.00
          </span>
        </div>
      </div>

      <div className="flex justify-center my-3">
        <ArrowRight
          size={18}
          className="rotate-90"
          style={{ color: answering ? C.iris : C.hairline, transition: "color .5s ease" }}
        />
      </div>

      <div
        className="glass rounded-xl p-5"
        style={{
          opacity: answering ? 1 : 0.35,
          transform: answering ? "none" : "translateY(6px)",
          transition: "opacity .5s ease, transform .5s ease",
          minHeight: 118,
        }}
      >
        <div className="data text-xs uppercase tracking-widest mb-2" style={{ color: C.iris }}>
          {t.hero.answerLabel}
        </div>
        <p className="text-sm leading-relaxed">
          {t.hero.answer.slice(0, typed)}
          {typing && (
            <span
              className="inline-block w-[2px] h-[1em] align-middle ms-0.5"
              style={{ background: C.iris, animation: "blink 1s steps(2) infinite" }}
            />
          )}
        </p>
      </div>
    </div>
  );
}

const CAP_ICONS = [MessageSquare, BarChart3, LineChart];
const DECISION_ICONS = [ShieldCheck, BookOpen, Gauge];

export default function Landing({ onSignIn, onRegister, onPricing }) {
  const C = useC();
  const { t } = useLang();
  const [menu, setMenu] = useState(false);
  const stageRef = useRef(null);

  const go = (id) => {
    setMenu(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  /* Subtle parallax: the hero visual drifts with the cursor. */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = stageRef.current;
    if (!el) return;
    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 14;
      const y = (e.clientY / window.innerHeight - 0.5) * 10;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="min-h-full substrate relative">
      {/* Ambient glow orbs */}
      <div className="glass-aura" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
      </div>

      <div className="relative z-10">
        <SectionRail ids={["story", "sources", "capabilities", "decision"]} />

        {/* Floating glass header */}
        <header className="sticky top-0 z-40 px-3 md:px-6 pt-3">
          <div className="glass-header-inner max-w-6xl mx-auto px-5 md:px-8 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <NeonMark size={32} glow={0.95} />
              <span className="display font-extrabold text-lg grad-text">{t.name}</span>
            </div>

            <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
              <button onClick={() => go("sources")} className="hover:opacity-70">{t.nav.how}</button>
              <button onClick={() => go("capabilities")} className="hover:opacity-70">{t.nav.what}</button>
              <button onClick={onPricing} className="hover:opacity-70">{t.pricing.nav}</button>
              <ThemeToggle compact />
              <LanguagePicker />
              <button onClick={onSignIn} className="hover:opacity-70">{t.common.signIn}</button>
              <button
                onClick={onRegister}
                className="gbtn gbtn-primary px-5 py-2 font-semibold"
              >
                {t.register.nav}
              </button>
            </nav>

            <div className="flex items-center gap-2 md:hidden">
              <ThemeToggle compact />
              <LanguagePicker compact />
              <button onClick={() => setMenu((m) => !m)} aria-label={t.nav.menu}>
                {menu ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>

          {menu && (
            <div className="md:hidden glass glass-header-inner max-w-6xl mx-auto mt-2 px-5 py-4 flex flex-col gap-3 text-sm font-medium">
              <button onClick={() => go("sources")} className="text-start py-1">{t.nav.how}</button>
              <button onClick={() => go("capabilities")} className="text-start py-1">{t.nav.what}</button>
              <button onClick={() => go("steps")} className="text-start py-1">{t.nav.start}</button>
              <button onClick={onPricing} className="text-start py-1">{t.pricing.nav}</button>
              <button
                onClick={onSignIn}
                className="mt-1 gbtn gbtn-primary px-4 py-2.5 font-semibold text-center"
              >
                {t.common.signIn}
              </button>
            </div>
          )}
        </header>

        {/* Hero */}
        <section id="story" className="px-6 md:px-10 lg:px-16 pt-14 pb-20 md:pt-20 md:pb-28">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="rise">
              <span className="eyebrow-chip data text-[11px] uppercase tracking-[0.18em]" style={{ color: C.iris }}>
                {t.hero.eyebrow}
              </span>
              <h1 className="display text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.08] mt-5 grad-text">
                {t.hero.title}
              </h1>
              <p className="mt-6 text-lg max-w-lg" style={{ color: C.slate }}>{t.hero.lead}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={onRegister}
                  className="gbtn gbtn-primary px-6 py-3 font-semibold inline-flex items-center gap-2"
                >
                  {t.register.nav} <ArrowRight size={17} className="flip-rtl" />
                </button>
                <button
                  onClick={() => go("sources")}
                  className="gbtn gbtn-ghost px-6 py-3 font-semibold"
                >
                  {t.hero.see}
                </button>
              </div>
            </div>

            <div className="rise" style={{ animationDelay: "120ms" }}>
              <div ref={stageRef} style={{ transition: "transform .2s ease-out" }}>
                <div className="float">
                  <div className="podium">
                    <span className="podium-glow" />
                    <span className="podium-ring" />
                    <TicketDemo />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Data journey */}
        <div className="hairline-edge" style={{ background: "transparent" }}>
          <Section id="sources" eyebrow={t.core.eyebrow} title={t.core.title} lead={t.core.lead}>
            <div className="glass bracket rounded-2xl p-5 md:p-8">
              <CoreDiagram />
            </div>
          </Section>
        </div>

        {/* Capabilities, each with a working picture of itself */}
        <Section
          id="capabilities"
          eyebrow={t.capabilities.eyebrow}
          title={t.capabilities.title}
          lead={t.capabilities.lead}
        >
          <div className="space-y-5">
            {t.capabilities.items.map((cap, i) => {
              const Icon = CAP_ICONS[i];
              const Demo = DEMOS[i];
              return (
                <div
                  key={cap.name}
                  className="glass-card glass p-6 md:p-8 grid md:grid-cols-[1fr_1.4fr] gap-6 md:gap-10 bracket"
                >
                  <div>
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--iris), var(--neon))" }}>
                        <Icon size={17} color={C.onPrimary} />
                      </div>
                      <span className="display font-extrabold text-2xl">{cap.name}</span>
                      <span className="index-num ms-auto" dir="ltr">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p className="text-base font-medium mb-5">{cap.line}</p>
                    <p className="text-sm leading-relaxed mb-5" style={{ color: C.slate }}>{cap.body}</p>
                    <ul className="space-y-2">
                      {cap.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm">
                          <Check size={16} className="mt-0.5 shrink-0" style={{ color: C.iris }} />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>{Demo ? <Demo /> : null}</div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* From insight to decision */}
        <div id="decision" className="hairline-edge">
          <Section eyebrow={t.decision.eyebrow} title={t.decision.title} lead={t.decision.lead}>
            <div className="grid md:grid-cols-3 gap-5">
              {t.decision.items.map((item, i) => {
                const Icon = DECISION_ICONS[i];
                return (
                  <div key={item.t} className="glass-card glass bracket p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: C.irisWash, border: `1px solid ${C.edge}` }}>
                        <Icon size={18} style={{ color: C.iris }} />
                      </div>
                      <span className="index-num" dir="ltr">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="display font-bold text-lg mb-1.5">{item.t}</div>
                    <p className="text-sm leading-relaxed" style={{ color: C.slate }}>{item.b}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        {/* Getting started — protocol stack */}
        <div style={{ background: C.panel }}>
          <section id="steps" className="px-6 md:px-10 lg:px-16 py-16 md:py-24">
            <div className="max-w-6xl mx-auto">
              <span className="eyebrow-chip data text-[11px] uppercase tracking-[0.18em]" style={{ color: C.lilac, borderColor: "rgba(192,132,252,0.3)", background: "rgba(192,132,252,0.08)" }}>
                {t.steps.eyebrow}
              </span>
              <h2
                className="display text-3xl md:text-4xl lg:text-5xl font-extrabold max-w-3xl leading-[1.15] mt-4"
                style={{ color: C.panelText }}
              >
                {t.steps.title}
              </h2>
              <div className="mt-12 grid md:grid-cols-3 gap-8 md:gap-6">
                {t.steps.items.map((step, i) => (
                  <div key={step.t} className="step-rail md:ps-6" style={{ borderTop: "1px solid rgba(255,255,255,.15)" }}>
                    <div className="display text-2xl pt-5 mb-3" style={{ color: C.lilac }} dir="ltr">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="display font-bold text-xl mb-2" style={{ color: C.panelText }}>{step.t}</div>
                    <p className="text-sm leading-relaxed" style={{ color: C.panelMuted }}>{step.b}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Close */}
        <section className="px-6 md:px-10 lg:px-16 py-20 md:py-28">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="display text-3xl md:text-4xl font-extrabold leading-[1.2] grad-text">{t.close.title}</h2>
            <p className="mt-4 text-base" style={{ color: C.slate }}>{t.close.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <button
                onClick={onSignIn}
                className="gbtn gbtn-primary px-7 py-3.5 font-semibold inline-flex items-center gap-2"
              >
                {t.common.signIn} <ArrowRight size={17} className="flip-rtl" />
              </button>
              <button
                onClick={onPricing}
                className="gbtn gbtn-ghost px-7 py-3.5 font-semibold"
              >
                {t.pricing.nav}
              </button>
            </div>
          </div>
        </section>

        {/* Footer with contact */}
        <footer style={{ background: C.panel }}>
          <div className="max-w-6xl mx-auto px-6 md:px-10 lg:px-16 py-14">
            <div className="grid md:grid-cols-[1.4fr_1fr_1fr] gap-10 md:gap-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <NeonMark size={34} glow={0.9} />
                  <span className="display font-extrabold text-lg" style={{ color: C.panelText }}>{t.name}</span>
                </div>
                <p className="text-sm max-w-xs leading-relaxed" style={{ color: C.panelMuted }}>
                  {t.contact.rights}
                </p>
              </div>

              {hasContact() && (
                <div>
                  <div className="data text-[11px] uppercase tracking-widest mb-4" style={{ color: C.lilac }}>
                    {t.contact.title}
                  </div>
                  <div className="space-y-3 text-sm">
                    {contactRows().map((row) => {
                      const Icon = { phone: Phone, email: Mail, instagram: Instagram }[row.kind];
                      return (
                        <a
                          key={row.kind}
                          href={row.href}
                          target={row.kind === "instagram" ? "_blank" : undefined}
                          rel="noreferrer"
                          className="flex items-center gap-2.5 hover:opacity-80"
                          style={{ color: C.panelMuted }}
                        >
                          <Icon size={14} />
                          <span dir="ltr">{row.label}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="data text-[11px] uppercase tracking-widest mb-4" style={{ color: C.lilac }}>
                  {t.nav.what}
                </div>
                <div className="flex flex-col gap-3 text-sm items-start">
                  <button onClick={() => go("sources")} className="hover:opacity-80" style={{ color: C.panelMuted }}>
                    {t.nav.how}
                  </button>
                  <button onClick={onPricing} className="hover:opacity-80" style={{ color: C.panelMuted }}>
                    {t.pricing.nav}
                  </button>
                  <button onClick={onSignIn} className="hover:opacity-80" style={{ color: C.panelMuted }}>
                    {t.common.signIn}
                  </button>
                </div>
              </div>
            </div>

            <div
              className="mt-12 pt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between text-xs"
              style={{ borderTop: "1px solid rgba(255,255,255,.1)", color: C.panelMuted }}
            >
              <span>© {new Date().getFullYear()} {t.name} — {t.footer.rights}</span>
              <div className="flex gap-4">
                <span>{t.contact.privacy}</span>
                <span>{t.contact.terms}</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
