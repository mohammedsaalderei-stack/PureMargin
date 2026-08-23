import { AlertTriangle, Eye, Lightbulb, ListChecks, MessageSquare, ShieldCheck, Timer, TrendingUp } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import { useStagger } from "../hooks.js";
import { SectionLabel } from "../ui.jsx";
import "../glass.css";

const FIGURE_LABEL = {
  sales: "sales", qty: "qty", perOrder: "perOrder", share: "share",
  quietOrders: "quietOrders", peakOrders: "peakOrders", peakHour: "peakHour",
  topBranch: "topBranch", gap: "gap",
};
const MONEY_KEYS = new Set(["sales", "perOrder"]);
const PERCENT_KEYS = new Set(["share", "gap"]);

function Confidence({ level }) {
  const C = useC();
  const { t } = useLang();
  const map = {
    high: { bg: "rgba(139,92,246,0.12)", fg: C.iris },
    medium: { bg: "rgba(167,139,250,0.10)", fg: C.lilac },
    low: { bg: "rgba(244,63,94,0.10)", fg: C.rose },
  };
  const s = map[level] || map.low;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
      style={{ background: s.bg, color: s.fg }}>
      <ShieldCheck size={12} />{t.advice[level]}
    </span>
  );
}

function Block({ icon: Icon, title, tone, children }) {
  const C = useC();
  const tones = {
    impact: { bg: "rgba(139,92,246,0.08)", fg: C.iris },
    watch: { bg: "rgba(167,139,250,0.06)", fg: C.lilac },
    caution: { bg: "rgba(244,63,94,0.08)", fg: C.rose },
    plain: { bg: "rgba(255,255,255,0.03)", fg: C.slate },
  };
  const s = tones[tone] || tones.plain;
  return (
    <div className="rounded-xl p-4" style={{ background: s.bg }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} style={{ color: s.fg }} />
        <span className="text-xs font-bold" style={{ color: s.fg }}>{title}</span>
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function AdviceCard({ item, index, shown, onAsk }) {
  const C = useC();
  const { t } = useLang();
  const copy = t.advice[item.kind];
  if (!copy) return null;
  const title = fill(copy.title, { name: item.subject });

  return (
    <div className="glass-card overflow-hidden flex flex-col g-stagger"
      style={{ "--i": index, opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(12px)",
        transition: `opacity .45s ease ${index * 90}ms, transform .45s ease ${index * 90}ms` }}>
      <div className="p-5 md:p-6 pb-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <Confidence level={item.confidence} />
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(139,92,246,0.12)" }}>
            <Lightbulb size={15} style={{ color: C.iris }} />
          </div>
        </div>
        <p className="text-[11px] leading-relaxed mb-4" style={{ color: C.slate }}>
          {fill(t.advice.basisNote, item.basis)}{item.confidence === "low" ? t.advice.basisStale : ""}
        </p>
        <h3 className="display font-bold text-xl mb-2">{title}</h3>
        <p className="text-sm leading-relaxed mb-4" style={{ color: C.slate }}>{copy.body}</p>
      </div>
      <div className="px-5 md:px-6 space-y-3">
        <Block icon={TrendingUp} title={t.advice.impact} tone="impact">{copy.impact}</Block>
      </div>
      <div className="px-5 md:px-6 py-5">
        <div className="text-xs font-semibold mb-3" style={{ color: C.slate }}>{t.advice.figuresTitle}</div>
        <div className="grid grid-cols-3 gap-3" style={{ borderBottom: `1px solid ${C.hairline}`, paddingBottom: 16 }}>
          {item.figures.map((f) => (
            <div key={f.key}>
              <div className="text-[11px] mb-1" style={{ color: C.slate }}>{t.watch[FIGURE_LABEL[f.key]] || t.advice[f.key] || f.key}</div>
              <div className="display font-bold text-base leading-none">
                {MONEY_KEYS.has(f.key) ? <Money value={f.value} /> :
                  <span dir="ltr">{typeof f.value === "number" ? f.value.toLocaleString("en-AE") : f.value}{PERCENT_KEYS.has(f.key) ? "%" : ""}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[11px] mt-3" style={{ color: C.slate }} dir="ltr">{t.advice.period}: {item.period.from} — {item.period.to}</div>
      </div>
      <div className="px-5 md:px-6 space-y-3 pb-5">
        <Block icon={ListChecks} title={t.advice.plan} tone="plain">
          <ol className="space-y-1.5">
            {copy.plan.map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="data text-xs shrink-0" style={{ color: C.iris }} dir="ltr">{i + 1}.</span>
                <span style={{ color: C.ink }}>{step}</span>
              </li>
            ))}
          </ol>
        </Block>
        <div className="grid sm:grid-cols-2 gap-3">
          <Block icon={Eye} title={t.advice.watch} tone="watch">{copy.watch}</Block>
          <Block icon={Timer} title={t.advice.measure} tone="plain">{fill(t.advice.measureIn, { days: item.measureInDays })}</Block>
        </div>
        <Block icon={AlertTriangle} title={t.advice.caution} tone="caution">{copy.caution}</Block>
      </div>
      <div className="px-5 md:px-6 pb-5 mt-auto">
        <button onClick={() => onAsk(`${title} — ${t.advice.ask}`)}
          className="w-full gpill gpill-primary inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold">
          <MessageSquare size={14} /> {t.advice.ask}
        </button>
      </div>
    </div>
  );
}

export default function Advice({ data, onAsk }) {
  const C = useC();
  const { t, lang } = useLang();
  const items = data.advice || [];
  const shown = useStagger(items.length, 120);

  if (!items.length) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <p className="text-sm" style={{ color: C.slate }}>{t.advice.empty}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8">
        <div className="text-center mb-6">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full mb-4"
            style={{ background: "rgba(139,92,246,0.10)", color: C.iris }}>
            <Lightbulb size={12} /> {t.advice.fromData}
          </span>
          <h2 className="display text-2xl md:text-3xl font-bold grad-text">{t.advice.title}</h2>
          <p className="text-sm mt-2 max-w-2xl mx-auto" style={{ color: C.slate }}>{t.advice.lead}</p>
          <p className="text-[11px] mt-3" style={{ color: C.slate }}>
            {t.advice.lastRun}: <span dir="ltr">{data.updatedAt ? new Date(data.updatedAt).toLocaleString(localeFor(lang)) : "—"}</span>
          </p>
        </div>
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-2">
          {items.map((item, i) => <AdviceCard key={item.id} item={item} index={i} shown={i < shown} onAsk={onAsk} />)}
          }
        </div>
      </div>
    </div>
  );
}
