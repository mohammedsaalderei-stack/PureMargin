import { useCallback, useEffect, useState } from "react";
import { Zap, Loader2, CheckCircle2, AlertTriangle, MinusCircle, RotateCcw } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* Receipts as the webhook delivered them, and what each one did to stock.

   ── Why this is not the list underneath it ───────────────────────────────

   The sales list reads the till. This reads the integration. A receipt can sit
   in Loyverse having never been delivered here, and a delivery can arrive and
   deduct nothing at all because the dish has no recipe — the till list shows
   the first as though it worked and cannot show the second, because nothing
   about a receipt says what happened to stock afterwards.

   ── The outcome is the column that matters ───────────────────────────────

   Every row says what the delivery did, not just that it happened. "Nothing
   to deduct — no recipe for Cheeseburger" is the single commonest reason a
   stock balance stops moving, and until now there was nowhere at all to see
   it: the sale looked normal, the balance quietly did not move, and the only
   way to find out was to suspect it and go looking.

   ── Three kinds of empty ─────────────────────────────────────────────────

   A blank list means one of three completely different things, so it never
   just renders blank. Nothing set up, set up but never fired — almost always
   a webhook generated and never pasted into Loyverse — or simply a quiet
   period. Each says which, and the middle one says what to do. */

const TONE = {
  deducted: "mint",
  duplicate: "slate",
  refund: "slate",
  cancelled: "slate",
  disabled: "amber",
  norecipe: "amber",
  nostore: "rose",
};

const ICON = {
  deducted: CheckCircle2,
  duplicate: RotateCcw,
  refund: MinusCircle,
  cancelled: MinusCircle,
  disabled: MinusCircle,
  norecipe: AlertTriangle,
  nostore: AlertTriangle,
};

export default function Deliveries({ token, branches }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.deliveries;

  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/deliveries", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setState(await res.json());
    } catch { /* the next refresh will show what stuck */ } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  /* Live receipts arrive without anybody asking, so the screen showing them
     should not need a refresh press to notice. Thirty seconds is the same
     cadence the dashboard already polls at. */
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const locale = localeFor(lang);
  const clock = (ms) => {
    try {
      return new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
        .replace(/[‎‏‪-‮⁦-⁩]/g, "");
    } catch { return ""; }
  };
  const day = (ms) => {
    try {
      return new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short" })
        .replace(/[‎‏‪-‮⁦-⁩]/g, "");
    } catch { return ""; }
  };

  if (loading && !state) {
    return (
      <div className="panel p-8 flex justify-center" style={{ color: C.slate }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (!state) return null;

  const rows = state.deliveries || [];
  const ing = state.ingestion || { state: "off" };
  const names = state.branchNames || {};

  /* The header chip. One line that answers "is this working" before anybody
     reads a single row. */
  const status = ing.state === "live"
    ? {
        tone: ing.quiet ? C.amber : C.mint,
        label: ing.quiet
          ? fill(s.quietFor, { minutes: ing.quietForMinutes })
          : s.liveNow,
      }
    : ing.state === "waiting"
      ? { tone: C.amber, label: s.waitingShort }
      : { tone: C.slate, label: s.offShort };

  return (
    <section className="panel p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="display font-bold text-base flex items-center gap-2">
          <span className="grid place-items-center w-7 h-7 rounded-lg shrink-0"
            style={{ background: "var(--chip-bg)" }}>
            <Zap size={14} style={{ color: C.iris }} />
          </span>
          {s.title}
        </h3>

        <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 shrink-0"
          style={{
            background: `color-mix(in srgb, ${status.tone} 14%, transparent)`,
            color: status.tone,
          }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.tone }} />
          {status.label}
        </span>
      </div>

      {rows.length === 0 ? (
        /* Never a bare "nothing here": the three empties mean different
           things and only one of them needs acting on. */
        <div className="text-center py-8 px-4">
          <Zap size={26} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
          <p className="text-sm" style={{ color: C.ink }}>
            {ing.state === "off" ? s.emptyOff
              : ing.state === "waiting" ? s.emptyWaiting
                : s.emptyQuiet}
          </p>
          {ing.state !== "live" && (
            <p className="text-xs mt-2" style={{ color: C.slate }}>{s.emptyHow}</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const tone = C[TONE[r.outcome] || "slate"] || C.slate;
            const Icon = ICON[r.outcome] || CheckCircle2;
            return (
              <div key={`${r.receiptNumber}-${r.receivedAt}`}
                className="flex items-start gap-3 py-2.5 px-3 rounded-lg"
                style={{ background: "var(--chip-bg)" }}>
                <Icon size={15} className="shrink-0 mt-0.5" style={{ color: tone }} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="data text-sm font-semibold" dir="ltr">{r.receiptNumber}</span>
                    <span className="text-[11px]" style={{ color: C.slate }}>
                      {clock(r.at)} · {day(r.at)}
                      {branches?.length > 1 && names[r.branchId] ? ` · ${names[r.branchId]}` : ""}
                    </span>
                  </div>

                  {/* What it did, in words. The reason this screen exists. */}
                  <div className="text-[11px] mt-0.5" style={{ color: tone }}>
                    {r.outcome === "deducted"
                      ? fill(s.deducted, { n: r.movements })
                      : r.outcome === "norecipe"
                        ? fill(s.norecipe, { names: (r.unmatched || []).join(", ") || s.theseItems })
                        : s.outcomes[r.outcome] || r.outcome}
                  </div>

                  {/* The items, so a row is recognisable without opening
                      anything. Truncated rather than scrolled: this is a feed,
                      and a receipt worth studying is studied in the list
                      below. */}
                  {r.lines?.length > 0 && (
                    <div className="text-[11px] mt-1 truncate-safe" style={{ color: C.slate }}>
                      {r.lines.slice(0, 3).map((l) => `${l.qty}× ${l.name}`).join(" · ")}
                      {r.lineCount > 3 ? ` · ${fill(s.andMore, { n: r.lineCount - 3 })}` : ""}
                    </div>
                  )}
                </div>

                <div className="text-end shrink-0">
                  <div className="text-sm font-bold"><Money value={r.total} decimals={2} /></div>
                  <div className="text-[10px]" style={{ color: C.slate }}>{clock(r.receivedAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
