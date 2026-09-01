import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calculator, ChevronLeft, ChevronRight, Layers, TrendingUp, PieChart,
  Building2, Package, Plus, Loader2,
} from "lucide-react";
import CostModal from "../costs/CostModal.jsx";
import CostRow from "../costs/CostRow.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* Cost management — a ledger somebody types into.

   ── What this screen deliberately does not do ────────────────────────────

   It does not read invoices. It does not match lines to a menu. It does not
   touch stock, recipes or the depletion engine. There is no camera on it.

   That is a removal, and the reason is worth writing down so it is not
   quietly reversed. The screen used to be the bill scanner: to record that
   packaging cost 1,620 in May, an owner had to photograph a document, wait for
   a model to read it, and then correct whatever it misread. Everything on the
   screen was downstream of a scan, so the plainest thing anybody wanted to do
   here — write down a number they already knew — was the one thing it could
   not do.

   Purchase-invoice scanning still exists and still belongs to Inventory,
   where a delivery note has quantities, units and a supplier to be received
   against. Here there is nothing to receive. Rent is not a delivery.

   ── The two halves ───────────────────────────────────────────────────────

   Constant costs recur and are held as a rate: rent every month, a licence
   every year. Variable costs happened once, on a day.

   Both are stated as what they come to in a month, because that is the only
   basis on which they can be added together, and the total of the two is the
   only figure on this screen anybody quotes.

   ── Why a month, and why one you can move ────────────────────────────────

   Constant costs do not have a month — they are the same every month by
   definition. Variable costs do. So the month picker moves the variable half
   and the total, and leaves the constant half alone. Without the picker the
   screen would silently mean "this month" and there would be no way to look at
   what April actually cost, which is the question asked at the end of a
   quarter rather than in the middle of one. */

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key, by) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
}

/* The first instant of a month and of the one after it, which is what the
   constant-cost endpoint apportions across. */
function monthWindow(key) {
  const [y, m] = key.split("-").map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

export default function Costs({ token }) {
  const C = useC();
  const { t, lang, rtl } = useLang();
  const s = t.costs;

  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [fixed, setFixed] = useState(null);
  const [variable, setVariable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* One dialog for both sections. `kind` decides its shape, `editing` decides
     whether it is an add or an amend. */
  const [dialog, setDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirming, setConfirming] = useState(null);

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    const [from, to] = monthWindow(month);
    try {
      const [fRes, vRes] = await Promise.all([
        fetch(`/api/fixedcosts?from=${from}&to=${to}`, { headers: auth }),
        fetch(`/api/varcosts?month=${month}`, { headers: auth }),
      ]);
      /* A 403 on either half is a permission answer, not a failure — the
         screen says so rather than showing an empty list that reads as
         "you have no costs". */
      if (fRes.status === 403 || vRes.status === 403) { setError(s.forbidden); return; }
      if (!fRes.ok || !vRes.ok) { setError(s.failed); return; }
      setError("");
      setFixed(await fRes.json());
      setVariable(await vRes.json());
    } catch {
      setError(s.failed);
    } finally {
      setLoading(false);
    }
  }, [auth, month, s.failed, s.forbidden]);

  useEffect(() => { load(); }, [load]);

  const fixedCosts = fixed?.costs || [];
  const variableCosts = variable?.costs || [];
  const mayWrite = fixed?.mayWrite !== false && variable?.mayWrite !== false;

  /* Both totals come from the server, which computed them from the same rows
     it sent. Re-adding them here would create a second answer that disagrees
     with the API the moment a rounding rule changes on one side only. */
  const totalFixed = fixed?.monthly || 0;
  const totalVariable = variable?.total || 0;
  const totalAll = Math.round((totalFixed + totalVariable) * 100) / 100;

  /* `localeFor` rather than the bare language code: the dictionary already
     decides that Arabic, Hindi and Urdu are formatted with Latin numerals,
     because a figure read off this screen gets typed into a till that only
     speaks them. Formatting is wrapped because an unsupported locale throws a
     RangeError, and a date that cannot be formatted should degrade to the raw
     one rather than take the whole screen down with it. */
  const locale = localeFor(lang);

  const dateText = (y, m, d, options) => {
    try {
      return new Date(y, m - 1, d).toLocaleDateString(locale, options)
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
    } catch {
      return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
    }
  };

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return dateText(y, m, 1, { month: "long", year: "numeric" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, locale]);

  const dayLabel = (iso) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    if (!y) return "";
    return dateText(y, m, d, { day: "numeric", month: "short", year: "numeric" });
  };

  async function save(values) {
    setSaving(true);
    setSaveError("");
    try {
      const isFixed = dialog.kind === "fixed";
      const url = isFixed ? "/api/fixedcosts" : "/api/varcosts";
      /* The constant-cost endpoint predates this screen and speaks
         `name`/`period`; the dialog speaks `title`/`frequency`. Translating at
         the one call site is cheaper than renaming a stored field that older
         records already carry. */
      const body = isFixed
        ? { id: dialog.editing?.id, name: values.title, amount: values.amount, period: values.frequency }
        : { id: dialog.editing?.id, title: values.title, amount: values.amount, date: values.date };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setSaveError(s.errServer); return; }
      setDialog(null);
      await load();
    } catch {
      setSaveError(s.errServer);
    } finally {
      setSaving(false);
    }
  }

  /* Two ways out for a constant cost, one for a variable one.

     `mode: "end"` closes a cost that really ran: it stops counting forwards
     and keeps costing the months it applied to, which is what a report over
     February needs when the rent stopped in March. `mode: "delete"` removes it
     entirely, for the entry that was never true of any month.

     A variable cost has only delete. It is a single dated line — there is no
     period it goes on applying to, so nothing is preserved by ending it. */
  async function remove(entry) {
    const url = entry.kind === "fixed"
      ? `/api/fixedcosts?id=${encodeURIComponent(entry.id)}${entry.mode === "end" ? "&end=1" : ""}`
      : `/api/varcosts?id=${encodeURIComponent(entry.id)}`;
    setConfirming(null);
    try {
      const res = await fetch(url, { method: "DELETE", headers: auth });
      if (!res.ok) { setError(s.errServer); return; }
      await load();
    } catch {
      setError(s.errServer);
    }
  }

  const metric = (label, value, Icon, tone) => (
    <div className="flex-1 min-w-0 px-2 text-center">
      <div className="mx-auto mb-2 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: C.irisWash, color: tone || C.iris }}>
        <Icon size={16} />
      </div>
      <div className="text-[11px] mb-1 truncate" style={{ color: C.slate }}>{label}</div>
      <div className="data text-xl font-bold" style={{ color: tone || C.ink }}>
        <Money value={value} />
      </div>
    </div>
  );

  const section = ({ title, note, rows, addLabel, onAdd }) => (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2 px-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.iris }} />
        <h3 className="display font-bold text-sm">{title}</h3>
      </div>
      <div className="panel p-3 md:p-4 space-y-2">
        {rows}
        {mayWrite && (
          <button type="button" onClick={onAdd}
            className="w-full rounded-xl py-3 text-xs font-semibold flex items-center justify-center gap-1.5"
            style={{ border: `1px dashed ${C.edge}`, color: C.iris, background: "transparent" }}>
            <Plus size={14} /> {addLabel}
          </button>
        )}
        {note && <p className="text-[11px] px-1 pt-1" style={{ color: C.slate }}>{note}</p>}
      </div>
    </section>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto w-full">

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="display font-bold text-xl">{s.title}</h2>
            <p className="text-xs mt-0.5" style={{ color: C.slate }}>{s.lead}</p>
          </div>
          <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: C.irisWash, color: C.iris }}>
            <Calculator size={19} />
          </div>
        </div>

        {/* The three figures, and the month they are being read for. */}
        <div className="panel p-4 md:p-5">
          <div className="flex items-center justify-between mb-4">
            {/* The arrows follow the writing direction, not the calendar. In
                Arabic and Urdu the previous month sits to the right and the
                glyph has to point that way, or the control reads backwards to
                everyone using it. */}
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))}
              aria-label={s.prevMonth} className="p-1.5 rounded-lg" style={{ color: C.slate }}>
              {rtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <div className="text-xs font-semibold">{monthLabel}</div>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))}
              aria-label={s.nextMonth} className="p-1.5 rounded-lg" style={{ color: C.slate }}>
              {rtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>

          <div className="flex items-start">
            {metric(s.totalFixed, totalFixed, Layers)}
            <div style={{ width: 1, alignSelf: "stretch", background: C.hairline }} />
            {metric(s.totalVariable, totalVariable, TrendingUp)}
            <div style={{ width: 1, alignSelf: "stretch", background: C.hairline }} />
            {metric(s.totalAll, totalAll, PieChart, C.iris)}
          </div>
        </div>

        {error && (
          <div className="panel p-4 text-sm" style={{ color: C.rose }}>{error}</div>
        )}

        {loading && !fixed && (
          <div className="flex justify-center py-10" style={{ color: C.slate }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {fixed && section({
          title: s.fixedTitle,
          note: s.fixedNote,
          addLabel: s.addFixed,
          onAdd: () => { setSaveError(""); setDialog({ kind: "fixed", editing: null }); },
          rows: (
            <>
              {fixedCosts.length === 0 && (
                <p className="text-sm px-1 py-3" style={{ color: C.slate }}>{s.fixedEmpty}</p>
              )}
              {fixedCosts.map((c) => (
                <CostRow
                  key={c.id}
                  icon={Building2}
                  title={c.name}
                  /* A yearly entry shows the yearly figure it was entered as
                     underneath the monthly one it is counted at, so the list
                     never contradicts what somebody remembers typing. */
                  subtitle={c.period === "monthly"
                    ? s.frequencies.monthly
                    : fill(s.perYearNote, { amount: Number(c.amount).toLocaleString() })}
                  amount={c.period === "yearly" ? c.amount / 12
                    : c.period === "weekly" ? (c.amount * 52) / 12
                      : c.amount}
                  mayWrite={mayWrite}
                  onEdit={() => {
                    setSaveError("");
                    setDialog({
                      kind: "fixed",
                      editing: {
                        id: c.id,
                        title: c.name,
                        amount: c.amount,
                        frequency: c.period === "yearly" ? "yearly" : "monthly",
                      },
                    });
                  }}
                  onEnd={() => setConfirming({ kind: "fixed", mode: "end", id: c.id, title: c.name })}
                  onDelete={() => setConfirming({ kind: "fixed", mode: "delete", id: c.id, title: c.name })}
                />
              ))}
            </>
          ),
        })}

        {variable && section({
          title: s.variableTitle,
          note: s.variableNote,
          addLabel: s.addVariable,
          onAdd: () => { setSaveError(""); setDialog({ kind: "variable", editing: null }); },
          rows: (
            <>
              {variableCosts.length === 0 && (
                <p className="text-sm px-1 py-3" style={{ color: C.slate }}>{s.variableEmpty}</p>
              )}
              {variableCosts.map((c) => (
                <CostRow
                  key={c.id}
                  icon={Package}
                  title={c.title}
                  subtitle={dayLabel(c.date)}
                  amount={c.amount}
                  mayWrite={mayWrite}
                  onEdit={() => {
                    setSaveError("");
                    setDialog({
                      kind: "variable",
                      editing: { id: c.id, title: c.title, amount: c.amount, date: c.date },
                    });
                  }}
                  onDelete={() => setConfirming({ kind: "variable", mode: "delete", id: c.id, title: c.title })}
                />
              ))}
            </>
          ),
        })}

        <CostModal
          open={Boolean(dialog)}
          kind={dialog?.kind}
          initial={dialog?.editing}
          busy={saving}
          error={saveError}
          onClose={() => setDialog(null)}
          onSave={save}
        />

        {/* Both actions are one tap from a menu, so both ask. Naming the row in
            the question is the part that matters — "delete this cost?" is not
            answerable without knowing which one is about to go — and ending is
            worded as what it does rather than as a softer delete, since the
            difference between the two is the whole reason both exist. */}
        {confirming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
            onClick={() => setConfirming(null)}>
            <div className="palette-in w-full sm:max-w-sm rounded-2xl p-5"
              style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
              onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <h3 className="display font-bold text-base mb-1">
                {confirming.mode === "end" ? s.endTitle : s.deleteTitle}
              </h3>
              <p className="text-sm mb-5" style={{ color: C.slate }}>
                {fill(confirming.mode === "end" ? s.endBody : s.deleteBody, { name: confirming.title })}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(null)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
                  style={{ border: `1px solid ${C.hairline}`, color: C.ink }}>
                  {s.cancel}
                </button>
                <button type="button" onClick={() => remove(confirming)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold"
                  style={{ background: confirming.mode === "end" ? C.iris : C.rose, color: C.onPrimary }}>
                  {confirming.mode === "end" ? s.end : s.delete}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
