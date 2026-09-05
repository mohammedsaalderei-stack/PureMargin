import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, Loader2, Pencil, AlertTriangle, Ban } from "lucide-react";
import SaleEditDialog from "../sales/SaleEditDialog.jsx";
import Deliveries from "../sales/Deliveries.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import { scopeQuery, scopeKey } from "../scopeParam.js";

/* Sales, as the till reported them — and what was changed.

   The POS is the record of what was sold, and this app reads it and never
   writes back. That left one ordinary situation with no answer at all: the
   till is wrong. A dish rung up at ten times its price, a table put through
   twice, an order voided on paper but not in the system. Before this the only
   choices were to accept a figure everyone on site knows is false, or to fix
   it upstream and hope a refetch carries the correction backwards.

   ── What the screen has to show, and why ─────────────────────────────────

   Both numbers, always. A corrected sale shows the till's figure struck
   through beside the one now counting. A screen that showed only the result
   would give nobody a way to see how much had been changed, which is the first
   thing anyone asks about a corrected total — and the only thing standing
   between "we fixed a typo" and money quietly leaving the books.

   Who and why, on the row. Every correction carries its reason and the person
   who made it, because a sale that stops counting is the single most abusable
   action in the product.

   Voided, not deleted. A voided sale stays on this list, struck through and
   marked. A sale that disappeared from both the till reading and this screen
   would be unaccountable by construction. */

const DAY = 864e5;
const RANGES = { d1: 1, d7: 7, d30: 30 };

export default function Sales({ token, branches = [] }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.sales;

  const [data, setData] = useState(null);
  const [range, setRange] = useState("d7");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const locale = localeFor(lang);

  const load = useCallback(async (days = RANGES[range]) => {
    setLoading(true);
    setFailed("");
    try {
      const res = await fetch(`/api/sales?days=${days}${scopeQuery(branches)}`, { headers: auth });
      if (!res.ok) {
        setFailed((await res.json().catch(() => ({}))).error || "failed");
        return;
      }
      setData(await res.json());
    } catch {
      setFailed("failed");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, range, scopeKey(branches)]);

  useEffect(() => { load(); }, [load]);

  const sales = data?.sales || [];
  const mayAdjust = Boolean(data?.mayAdjust);

  /* Stated at the top rather than left to be noticed: how much of what is on
     screen is the till's own reading and how much is a person's correction. */
  const corrected = sales.filter((x) => x.edit);
  const netChange = corrected.reduce((n, x) => {
    const was = x.till?.total || 0;
    const now = x.edit?.voided ? 0 : (x.current?.total ?? was);
    return n + (now - was);
  }, 0);

  const when = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(locale, {
        day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
      }).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
    } catch {
      return String(iso).slice(0, 16).replace("T", " ");
    }
  };

  async function save(values) {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ receiptId: editing.id, ...values }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(s.errors[body.error] || s.errServer);
        return;
      }
      setEditing(null);
      await load();
    } catch {
      setSaveError(s.errServer);
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sales?receiptId=${encodeURIComponent(editing.id)}`, {
        method: "DELETE", headers: auth,
      });
      if (!res.ok) { setSaveError(s.errServer); return; }
      setEditing(null);
      await load();
    } catch {
      setSaveError(s.errServer);
    } finally {
      setSaving(false);
    }
  }

  if (!data && failed) {
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="display font-bold text-lg mb-2">{s.failedTitle}</p>
          <p className="text-sm mb-5" style={{ color: C.slate }}>
            {s.errors[failed] || s.failedLead}
          </p>
          <button onClick={() => load()} className="gpill gpill-primary px-4 py-2 text-sm font-semibold">
            {t.common.tryAgain}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto w-full">

        <div>
          <h2 className="display font-bold text-xl flex items-center gap-2">
            <Receipt size={18} style={{ color: C.iris }} /> {s.title}
          </h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
        </div>

        {/* What the webhook brought in, above what the till holds.

            Two lists rather than one, because they answer different questions
            and neither can be derived from the other: this one is the
            integration — did it fire, and what did each delivery do to stock —
            and the one below is the business, everything the till has whether
            it reached us live or not. */}
        <Deliveries token={token} branches={branches} />

        <div>
        </div>

        <div className="flex gap-1.5">
          {Object.keys(RANGES).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={range === r
                ? { background: C.iris, color: C.onPrimary }
                : { border: `1px solid ${C.hairline}`, color: C.slate }}>
              {s.ranges[r]}
            </button>
          ))}
        </div>

        {corrected.length > 0 && (
          <div className="panel p-4 flex items-start gap-2.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: C.iris }} />
            <p className="text-sm" style={{ color: C.ink }}>
              {fill(s.correctedSummary, { n: corrected.length })}{" "}
              <span className="data font-bold" style={{ color: netChange < 0 ? C.rose : C.ink }}>
                <Money value={Math.round(netChange * 100) / 100} />
              </span>
            </p>
          </div>
        )}

        {loading && !data && (
          <div className="flex justify-center py-10" style={{ color: C.slate }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {data && sales.length === 0 && (
          <p className="text-sm py-10 text-center" style={{ color: C.slate }}>{s.empty}</p>
        )}

        <div className="space-y-2">
          {sales.map((sale) => {
            const voided = Boolean(sale.edit?.voided);
            const changed = Boolean(sale.edit);
            const now = voided ? 0 : (sale.current?.total ?? sale.till?.total ?? 0);
            return (
              <div key={sale.id} className="panel p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{when(sale.at)}</span>
                      {voided && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: C.irisWash, color: C.rose }}>
                          <Ban size={10} /> {s.voided}
                        </span>
                      )}
                      {sale.edit?.stale && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: C.irisWash, color: C.iris }}>
                          {s.stale}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: C.slate }}>
                      {fill(s.receiptRef, { id: sale.id })}
                      {sale.till?.lines?.length ? ` · ${fill(s.lineCount, { n: sale.till.lines.length })}` : ""}
                    </div>
                  </div>

                  <div className="shrink-0 text-end">
                    {/* The till's figure stays visible whenever it differs. */}
                    {changed && (
                      <div className="data text-[11px] line-through" style={{ color: C.slate }}>
                        <Money value={sale.till?.total || 0} />
                      </div>
                    )}
                    <div className="data text-sm font-bold"
                      style={voided ? { color: C.slate, textDecoration: "line-through" } : undefined}>
                      <Money value={now} />
                    </div>
                  </div>

                  {mayAdjust && (
                    <button type="button"
                      onClick={() => { setSaveError(""); setEditing({ ...sale, reasons: data.reasons }); }}
                      aria-label={s.editTitle}
                      className="shrink-0 p-1.5 rounded-lg" style={{ color: C.slate }}>
                      <Pencil size={15} />
                    </button>
                  )}
                </div>

                {/* Why, and by whom. On the row rather than behind a tap: a
                    correction nobody can see the reason for is the one worth
                    hiding. */}
                {changed && (
                  <div className="mt-2.5 pt-2.5 text-[11px] flex flex-wrap gap-x-2 gap-y-1"
                    style={{ borderTop: `1px solid ${C.hairline}`, color: C.slate }}>
                    <span style={{ color: C.iris }}>{s.reasons[sale.edit.reason] || sale.edit.reason}</span>
                    {sale.edit.by && <span>· {fill(s.byWhom, { name: sale.edit.by })}</span>}
                    {sale.edit.note && <span>· {sale.edit.note}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!mayAdjust && data && (
          <p className="text-[11px] pt-1" style={{ color: C.slate }}>{s.readOnly}</p>
        )}

        <SaleEditDialog
          open={Boolean(editing)}
          sale={editing}
          busy={saving}
          error={saveError}
          onClose={() => setEditing(null)}
          onSave={save}
          onRestore={restore}
        />
      </div>
    </div>
  );
}
