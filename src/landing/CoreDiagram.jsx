import { ArrowRight, Boxes, Database, MessageSquare, ScrollText, Store, BarChart3, LineChart } from "lucide-react";
import { useLang } from "../i18n.jsx";
import { useReveal } from "../hooks.js";

const SOURCE_ICONS = [Store, ScrollText, Boxes];
const OUT_ICONS = [MessageSquare, BarChart3, LineChart];

/* The architecture, drawn editorially: three sources converge on one
   layer, three outputs come off it. Thin rules and small dots instead
   of glass and glow — the single trusted middle is still the thing
   you actually see. */
export default function CoreDiagram() {
  const { t } = useLang();
  const [ref, shown] = useReveal(0.2);
  const core = t.core;

  const Node = ({ icon: Icon, title, body, delay }) => (
    <div
      className="flex gap-3 items-start"
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(10px)",
        transition: `opacity .5s ease ${delay}ms, transform .5s ease ${delay}ms`,
      }}
    >
      <div className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0 mt-0.5" style={{ border: "1px solid var(--ed-line-strong)" }}>
        <Icon size={15} style={{ color: "var(--ed-accent)" }} />
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs mt-0.5 leading-relaxed ed-lead">{body}</div>
      </div>
    </div>
  );

  return (
    <div ref={ref} className="grid lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-6 lg:gap-4 items-center">
      <div className="space-y-4">
        <div className="ed-eyebrow mb-1">{core.sourcesLabel}</div>
        {t.sources.items.map((s, i) => (
          <Node key={s.title} icon={SOURCE_ICONS[i]} title={s.title} body={s.body} delay={i * 90} />
        ))}
      </div>

      <div className="hidden lg:flex justify-center">
        <ArrowRight size={18} className="flip-rtl" style={{ color: "var(--ed-line-strong)", opacity: shown ? 1 : 0, transition: "opacity .5s ease .35s" }} />
      </div>

      <div
        className="ed-card p-6 text-center"
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? "scale(1)" : "scale(.96)",
          transition: "opacity .55s ease .3s, transform .55s cubic-bezier(.2,.8,.3,1.05) .3s",
        }}
      >
        <div className="w-10 h-10 rounded-sm mx-auto flex items-center justify-center mb-3" style={{ border: "1px solid var(--ed-line-strong)" }}>
          <Database size={18} style={{ color: "var(--ed-accent)" }} />
        </div>
        <div className="ed-display font-bold text-lg mb-1.5">{core.coreTitle}</div>
        <p className="ed-lead text-xs leading-relaxed mb-3">{core.coreBody}</p>
        <span className="ed-eyebrow" style={{ color: "var(--ed-accent)" }}>{core.coreTag}</span>
      </div>

      <div className="hidden lg:flex justify-center">
        <ArrowRight size={18} className="flip-rtl" style={{ color: "var(--ed-line-strong)", opacity: shown ? 1 : 0, transition: "opacity .5s ease .55s" }} />
      </div>

      <div className="space-y-4">
        <div className="ed-eyebrow mb-1">{core.outputsLabel}</div>
        {core.outputs.map((o, i) => (
          <Node key={o.t} icon={OUT_ICONS[i]} title={o.t} body={o.b} delay={600 + i * 90} />
        ))}
      </div>

      <div className="lg:col-span-5 flex flex-wrap gap-2 justify-center pt-4">
        {core.chips.map((c, i) => (
          <span
            key={c}
            className="text-xs px-3.5 py-1.5 rounded-sm"
            style={{
              border: "1px solid var(--ed-line)",
              color: "var(--ed-muted)",
              opacity: shown ? 1 : 0,
              transition: `opacity .4s ease ${900 + i * 80}ms`,
            }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}
