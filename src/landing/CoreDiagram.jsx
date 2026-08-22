import { ArrowRight, Boxes, Database, LineChart, MessageSquare, ScrollText, Store, BarChart3 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { useReveal } from "../hooks.js";

const SOURCE_ICONS = [Store, ScrollText, Boxes];
const OUT_ICONS = [MessageSquare, BarChart3, LineChart];

/* The architecture, drawn: three sources converge on one layer, three outputs
   come off it. Prose can describe this, but a diagram makes the single
   trusted middle the thing you actually see — which is the whole claim. */
export default function CoreDiagram() {
  const C = useC();
  const { t } = useLang();
  const [ref, shown] = useReveal(0.2);
  const core = t.core;

  const Node = ({ icon: Icon, title, body, delay }) => (
    <div
      className="rounded-xl p-4 flex gap-3 items-start"
      style={{
        background: C.surface,
        border: `1px solid ${C.hairline}`,
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(10px)",
        transition: `opacity .5s ease ${delay}ms, transform .5s ease ${delay}ms`,
      }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: C.irisWash }}>
        <Icon size={16} style={{ color: C.iris }} />
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs mt-0.5 leading-relaxed" style={{ color: C.slate }}>{body}</div>
      </div>
    </div>
  );

  return (
    <div ref={ref} className="grid lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 lg:gap-3 items-center">
      <div className="space-y-3">
        <div className="data text-[11px] uppercase tracking-widest mb-2" style={{ color: C.slate }}>
          {core.sourcesLabel}
        </div>
        {t.sources.items.map((s, i) => (
          <Node key={s.title} icon={SOURCE_ICONS[i]} title={s.title} body={s.body} delay={i * 90} />
        ))}
      </div>

      <div className="hidden lg:flex justify-center">
        <ArrowRight
          size={20}
          className="flip-rtl"
          style={{ color: C.hairline, opacity: shown ? 1 : 0, transition: "opacity .5s ease .35s" }}
        />
      </div>

      <div
        className="rounded-2xl p-6 text-center"
        style={{
          background: C.panel,
          opacity: shown ? 1 : 0,
          transform: shown ? "scale(1)" : "scale(.95)",
          transition: "opacity .55s ease .3s, transform .55s cubic-bezier(.2,.8,.3,1.05) .3s",
        }}
      >
        <div className="w-11 h-11 rounded-xl mx-auto flex items-center justify-center mb-3" style={{ background: C.iris }}>
          <Database size={20} style={{ color: C.onPrimary }} />
        </div>
        <div className="display font-extrabold text-lg mb-1.5" style={{ color: C.panelText }}>
          {core.coreTitle}
        </div>
        <p className="text-xs leading-relaxed mb-3" style={{ color: C.panelMuted }}>{core.coreBody}</p>
        <span
          className="data text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full inline-block"
          style={{ background: "rgba(255,255,255,.1)", color: C.lilac }}
        >
          {core.coreTag}
        </span>
      </div>

      <div className="hidden lg:flex justify-center">
        <ArrowRight
          size={20}
          className="flip-rtl"
          style={{ color: C.hairline, opacity: shown ? 1 : 0, transition: "opacity .5s ease .55s" }}
        />
      </div>

      <div className="space-y-3">
        <div className="data text-[11px] uppercase tracking-widest mb-2" style={{ color: C.slate }}>
          {core.outputsLabel}
        </div>
        {core.outputs.map((o, i) => (
          <Node key={o.t} icon={OUT_ICONS[i]} title={o.t} body={o.b} delay={600 + i * 90} />
        ))}
      </div>

      <div className="lg:col-span-5 flex flex-wrap gap-2 justify-center pt-3">
        {core.chips.map((c, i) => (
          <span
            key={c}
            className="text-xs px-3 py-1.5 rounded-full"
            style={{
              background: C.irisWash,
              color: C.irisDeep,
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
