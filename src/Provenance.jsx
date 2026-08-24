import { useState } from "react";
import { Info, ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang, fill } from "./i18n.jsx";

/* "Where these figures come from", shown under the dashboard.

   Collapsed it is one quiet line, because on a normal day the answer is boring
   and shouldn't compete with the numbers. It opens into the full account: the
   period, the branches, the receipt counts, cost coverage, and when the POS was
   last actually reached.

   The one thing it says loudly is a stale or failing sync. Figures served from
   cache while the POS is unreachable look completely normal on a chart, and
   someone deciding what to order tomorrow needs to know the difference. */

function Row({ label, value, tone }) {
  const C = useC();
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs" style={{ color: C.slate }}>{label}</span>
      <span className="text-xs font-medium text-end" style={{ color: tone || C.ink }}>{value}</span>
    </div>
  );
}

export default function Provenance({ provenance: p }) {
  const C = useC();
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);

  if (!p) return null;

  /* The palette has no amber; rose is the app's one warning colour. */
  const warn = C.rose;

  const when = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(lang === "ar" ? "ar-AE" : undefined, {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch { return "—"; }
  };

  /* A failed last sync is the case worth interrupting for; everything else is
     reference material the reader can open if they want it. */
  const failing = p.lastSync && !p.lastSync.ok;
  const thinCosts = p.costs.coveragePct < 60;

  const summary = failing
    ? t.provenance.failing
    : fill(t.provenance.summary, {
        source: p.source,
        branches: p.branches.complete
          ? t.scope.all.toLowerCase()
          : p.branches.names.join(", ") || t.provenance.noBranches,
        when: when(p.fetchedAt),
      });

  return (
    <div className="panel px-4 py-3" style={{ borderColor: failing ? warn : undefined }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-start">
        {failing
          ? <AlertTriangle size={14} style={{ color: warn }} />
          : <Info size={14} style={{ color: C.slate }} />}
        <span className="flex-1 text-xs" style={{ color: failing ? warn : C.slate }}>{summary}</span>
        <ChevronDown size={13} style={{ color: C.slate, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div className="mt-3 pt-3 grid gap-x-8 md:grid-cols-2" style={{ borderTop: `1px solid ${C.hairline}` }}>
          <div>
            <Row label={t.provenance.source} value={p.source} />
            <Row label={t.provenance.fetchedAt} value={when(p.fetchedAt)} />
            <Row
              label={t.provenance.lastSync}
              value={p.lastSync ? `${when(p.lastSync.at)}${p.lastSync.ok ? "" : ` — ${t.provenance.failed}`}` : t.provenance.never}
              tone={p.lastSync && !p.lastSync.ok ? warn : undefined}
            />
            <Row label={t.provenance.period}
              value={fill(t.provenance.periodValue, { days: p.period.reportedDays })} />
            {p.period.limitedHistory && (
              <Row label={t.provenance.history} value={t.provenance.historyLimited} tone={warn} />
            )}
          </div>

          <div>
            <Row
              label={t.provenance.branches}
              value={p.branches.complete
                ? fill(t.provenance.branchesAll, { total: p.branches.total })
                : `${p.branches.names.join(", ") || "—"} (${p.branches.count}/${p.branches.total})`}
            />
            <Row label={t.provenance.receipts}
              value={fill(t.provenance.receiptsValue, { counted: p.receipts.counted, fetched: p.receipts.fetched })} />
            <Row label={t.provenance.costs}
              value={`${p.costs.coveragePct}%`}
              tone={thinCosts ? warn : undefined} />
            {p.costs.ownerEntered > 0 && (
              <Row label={t.provenance.ownerCosts}
                value={fill(t.provenance.ownerCostsValue, { n: p.costs.ownerEntered })} />
            )}
            {p.branches.exact && (
              <div className="flex items-center gap-1.5 pt-2">
                <CheckCircle2 size={12} style={{ color: C.iris }} />
                <span className="text-[11px]" style={{ color: C.slate }}>{t.provenance.exact}</span>
              </div>
            )}
          </div>

          {thinCosts && (
            <p className="text-[11px] mt-3 md:col-span-2" style={{ color: C.slate }}>
              {t.provenance.costsNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
