import { useEffect, useState } from "react";
import {
  ArrowRight, Menu, X, Mail, Phone, Instagram, ShieldCheck, BookOpen, Gauge,
  MessageSquare, BarChart3, LineChart, Check,
} from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { contactRows, hasContact } from "./contact.js";
import { useLang } from "./i18n.jsx";
import { useReveal, prefersReducedMotion } from "./hooks.js";
import { DirhamMark } from "./Dirham.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import CoreDiagram from "./landing/CoreDiagram.jsx";
import { DEMOS } from "./landing/Demos.jsx";
import "./landing-editorial.css";

/* Editorial quiet-luxury landing — Vide Infra inspired.
   Warm paper, charcoal type, thin rules, generous whitespace.
   The receipt that prints and resolves into a plain-language answer
   stays (it's the product's premise in one motion), but it sits on
   paper now, not on glass. */

function TicketDemo() {
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
    <div className="w-full max-w-md mx-auto lg:mx-0">
      <div className="ed-receipt p-6">
        <div className="flex items-baseline justify-between mb-1 pt-2">
          <span className="display font-bold text-sm">{t.hero.ticketTable}</span>
          <span className="data text-xs" style={{ color: "var(--ed-muted)" }} dir="ltr">#4471</span>
        </div>
        <div className="data text-xs mb-5" style={{ color: "var(--ed-muted)" }}>{t.hero.ticketMeta}</div>

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
              <span className="data" style={{ color: "var(--ed-muted)" }} dir="ltr">{amt}</span>
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

      <div className="flex justify-center my-4">
        <ArrowRight
          size={16}
          className="rotate-90"
          style={{ color: answering ? "var(--ed-accent)" : "var(--ed-line-strong)", transition: "color .5s ease" }}
        />
      </div>

      <div
        className="ed-card p-5"
        style={{
          opacity: answering ? 1 : 0.35,
          transform: answering ? "none" : "translateY(6px)",
          transition: "opacity .5s ease, transform .5s ease",
          minHeight: 118,
        }}
      >
        <div className="ed-eyebrow mb-2" style={{ color: "var(--ed-accent)" }}>
          {t.hero.answerLabel}
        </div>
        <p className="text-sm leading-relaxed">
          {t.hero.answer.slice(0, typed)}
          {typing && (
            <span
              className="inline-block w-[2px] h-[1em] align-middle ms-0.5"
              style={{ background: "var(--ed-accent)", animation: "blink 1s steps(2) infinite" }}
            />
          )}
        </p>
      </div>
    </div>
  );
}

const CAP_ICONS = [MessageSquare, BarChart3, LineChart];
const DECISION_ICONS = [ShieldCheck, BookOpen, Gauge];

function Block({ id, index, children }) {
  const [ref, shown] = useReveal();
  return (
    <section id={id} ref={ref} className="ed-section">
      <div className="ed-wrap">
        <div className={shown ? "rise" : "opacity-0"}>{children}</div>
      </div>
    </section>
  );
}

export default function Landing({ onSignIn, onRegister, onPricing }) {
  const { t } = useLang();
  const [menu, setMenu] = useState(false);

  const go = (id) => {
    setMenu(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="editorial relative">
      {/* Header */}
      <header className="ed-header">
        <div className="ed-wrap px-6 md:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark size={30} />
            <span className="display font-bold text-lg">{t.name}</span>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            <button onClick={() => go("sources")} className="hover:opacity-60">{t.nav.how}</button>
            <button onClick={() => go("capabilities")} className="hover:opacity-60">{t.nav.what}</button>
            <button onClick={onPricing} className="hover:opacity-60">{t.pricing.nav}</button>
            <ThemeToggle compact />
            <LanguagePicker />
            <button onClick={onSignIn} className="hover:opacity-60">{t.common.signIn}</button>
            <button onClick={onRegister} className="ed-btn ed-btn-primary px-5 py-2">
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
          <div className="md:hidden border-t" style={{ borderColor: "var(--ed-line)" }}>
            <div className="ed-wrap px-6 py-4 flex flex-col gap-3 text-sm font-medium">
              <button onClick={() => go("sources")} className="text-start py-1">{t.nav.how}</button>
              <button onClick={() => go("capabilities")} className="text-start py-1">{t.nav.what}</button>
              <button onClick={() => go("steps")} className="text-start py-1">{t.nav.start}</button>
              <button onClick={onPricing} className="text-start py-1">{t.pricing.nav}</button>
              <button onClick={onSignIn} className="ed-btn ed-btn-primary px-4 py-2.5 mt-1 justify-center">
                {t.common.signIn}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section id="story" className="ed-section relative overflow-hidden">
        {/* thin geometric circle motif */}
        <span className="ed-circle hidden lg:block" style={{ width: 520, height: 520, top: -120, right: -160 }} />
        <span className="ed-circle hidden lg:block" style={{ width: 340, height: 340, top: 60, right: -60 }} />

        <div className="ed-wrap relative">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-20 items-center">
            <div className="rise">
              <span className="ed-eyebrow">{t.hero.eyebrow}</span>
              <h1 className="ed-display text-[2.6rem] md:text-6xl lg:text-[4.2rem] mt-6">
                {t.hero.title}
              </h1>
              <p className="ed-lead mt-7 text-lg max-w-lg">{t.hero.lead}</p>
              <div className="mt-9 flex flex-wrap gap-4 items-center">
                <button onClick={onRegister} className="ed-btn ed-btn-primary px-6 py-3">
                  {t.register.nav} <ArrowRight size={16} className="flip-rtl" />
                </button>
                <button onClick={() => go("sources")} className="ed-link">
                  {t.hero.see} <ArrowRight size={15} className="flip-rtl" />
                </button>
              </div>
            </div>

            <div className="rise" style={{ animationDelay: "120ms" }}>
              <TicketDemo />
            </div>
          </div>
        </div>
      </section>

      <hr className="ed-rule ed-wrap" style={{ marginLeft: "auto", marginRight: "auto" }} />

      {/* Data journey */}
      <Block id="sources">
        <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-12 items-start mb-12">
          <span className="ed-num">01</span>
          <div>
            <span className="ed-eyebrow">{t.core.eyebrow}</span>
            <h2 className="ed-display text-3xl md:text-4xl lg:text-5xl mt-4 max-w-2xl">{t.core.title}</h2>
            <p className="ed-lead mt-4 max-w-xl">{t.core.lead}</p>
          </div>
        </div>
        <div className="ed-card p-6 md:p-10">
          <CoreDiagram />
        </div>
      </Block>

      <hr className="ed-rule ed-wrap" style={{ marginLeft: "auto", marginRight: "auto" }} />

      {/* Capabilities */}
      <Block id="capabilities">
        <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-12 items-start mb-14">
          <span className="ed-num">02</span>
          <div>
            <span className="ed-eyebrow">{t.capabilities.eyebrow}</span>
            <h2 className="ed-display text-3xl md:text-4xl lg:text-5xl mt-4 max-w-2xl">{t.capabilities.title}</h2>
            <p className="ed-lead mt-4 max-w-xl">{t.capabilities.lead}</p>
          </div>
        </div>

        <div className="space-y-8">
          {t.capabilities.items.map((cap, i) => {
            const Icon = CAP_ICONS[i];
            const Demo = DEMOS[i];
            const flip = i % 2 === 1;
            return (
              <div key={cap.name} className="ed-card ed-card-hover p-7 md:p-10">
                <div className={`grid md:grid-cols-2 gap-8 md:gap-14 items-center ${flip ? "md:[direction:rtl]" : ""}`}>
                  <div className="[direction:ltr]">
                    <div className="flex items-center gap-3 mb-4">
                      <Icon size={20} style={{ color: "var(--ed-accent)" }} />
                      <span className="ed-num">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="ed-display text-2xl md:text-3xl mb-3">{cap.name}</h3>
                    <p className="font-medium text-base mb-4">{cap.line}</p>
                    <p className="ed-lead text-sm leading-relaxed mb-5">{cap.body}</p>
                    <ul className="space-y-2.5">
                      {cap.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm">
                          <Check size={15} className="mt-0.5 shrink-0" style={{ color: "var(--ed-accent)" }} />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="[direction:ltr]">{Demo ? <Demo /> : null}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Block>

      <hr className="ed-rule ed-wrap" style={{ marginLeft: "auto", marginRight: "auto" }} />

      {/* From insight to decision */}
      <Block id="decision">
        <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-12 items-start mb-14">
          <span className="ed-num">03</span>
          <div>
            <span className="ed-eyebrow">{t.decision.eyebrow}</span>
            <h2 className="ed-display text-3xl md:text-4xl lg:text-5xl mt-4 max-w-2xl">{t.decision.title}</h2>
            <p className="ed-lead mt-4 max-w-xl">{t.decision.lead}</p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-px" style={{ background: "var(--ed-line)" }}>
          {t.decision.items.map((item, i) => {
            const Icon = DECISION_ICONS[i];
            return (
              <div key={item.t} className="ed-card p-8" style={{ border: "none", borderRadius: 0 }}>
                <div className="flex items-center gap-3 mb-5">
                  <Icon size={18} style={{ color: "var(--ed-accent)" }} />
                  <span className="ed-num">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <div className="ed-display font-bold text-xl mb-2">{item.t}</div>
                <p className="ed-lead text-sm leading-relaxed">{item.b}</p>
              </div>
            );
          })}
        </div>
      </Block>

      {/* Getting started */}
      <div style={{ background: "var(--ed-surface-2)" }}>
        <section id="steps" className="ed-section">
          <div className="ed-wrap">
            <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-12 items-start mb-14">
              <span className="ed-num">04</span>
              <div>
                <span className="ed-eyebrow">{t.steps.eyebrow}</span>
                <h2 className="ed-display text-3xl md:text-4xl lg:text-5xl mt-4 max-w-2xl">{t.steps.title}</h2>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-10 md:gap-8">
              {t.steps.items.map((step, i) => (
                <div key={step.t} className="pt-6" style={{ borderTop: "1px solid var(--ed-line-strong)" }}>
                  <div className="ed-num mb-4">{String(i + 1).padStart(2, "0")}</div>
                  <div className="ed-display font-bold text-xl mb-2.5">{step.t}</div>
                  <p className="ed-lead text-sm leading-relaxed">{step.b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Close */}
      <section className="ed-section">
        <div className="ed-wrap max-w-3xl text-center">
          <h2 className="ed-display text-3xl md:text-4xl lg:text-5xl">{t.close.title}</h2>
          <p className="ed-lead mt-5">{t.close.lead}</p>
          <div className="mt-9 flex flex-wrap gap-4 justify-center">
            <button onClick={onSignIn} className="ed-btn ed-btn-primary px-7 py-3.5">
              {t.common.signIn} <ArrowRight size={16} className="flip-rtl" />
            </button>
            <button onClick={onPricing} className="ed-btn ed-btn-ghost px-7 py-3.5">
              {t.pricing.nav}
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: "var(--ed-surface-2)", borderTop: "1px solid var(--ed-line)" }}>
        <div className="ed-wrap px-6 md:px-10 py-14">
          <div className="grid md:grid-cols-[1.4fr_1fr_1fr] gap-10 md:gap-8">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <BrandMark size={32} />
                <span className="display font-bold text-lg">{t.name}</span>
              </div>
              <p className="ed-lead text-sm max-w-xs">{t.contact.rights}</p>
            </div>

            {hasContact() && (
              <div>
                <div className="ed-eyebrow mb-4">{t.contact.title}</div>
                <div className="space-y-3 text-sm">
                  {contactRows().map((row) => {
                    const Icon = { phone: Phone, email: Mail, instagram: Instagram }[row.kind];
                    return (
                      <a
                        key={row.kind}
                        href={row.href}
                        target={row.kind === "instagram" ? "_blank" : undefined}
                        rel="noreferrer"
                        className="flex items-center gap-2.5 hover:opacity-70 ed-lead"
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
              <div className="ed-eyebrow mb-4">{t.nav.what}</div>
              <div className="flex flex-col gap-3 text-sm items-start">
                <button onClick={() => go("sources")} className="ed-lead hover:opacity-70">{t.nav.how}</button>
                <button onClick={onPricing} className="ed-lead hover:opacity-70">{t.pricing.nav}</button>
                <button onClick={onSignIn} className="ed-lead hover:opacity-70">{t.common.signIn}</button>
              </div>
            </div>
          </div>

          <div
            className="mt-12 pt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between text-xs ed-lead"
            style={{ borderTop: "1px solid var(--ed-line)" }}
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
  );
}
