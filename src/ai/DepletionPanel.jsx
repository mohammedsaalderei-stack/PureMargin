import { useState } from "react";
import { PackageMinus, Loader2, Check, AlertTriangle } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Taking a scanned bill out of stock.

   The plan arrives from the scan already worked out — recipes expanded,
   quantities scaled by how many were sold, yield applied. What is left is the
   decision, and the decision is deliberately a person's.

   A scan is a reading of a photograph. It is usually right and occasionally
   reads 11 as 4, and a wrong `consume` is not a display error: it moves the
   balance that the variance screen later treats as fact, which is the one
   number in this product that has to be trustworthy. So the movements are
   listed in full, in the units they will be written in, and nothing happens
   until somebody presses the button.

   Quantities are editable here for the same reason the bill lines are. A cook
   who knows the kitchen ran the last dish short should be able to say so
   before it becomes a discrepancy somebody investigates next week. */

export default function DepletionPanel({ token, plan, branchId, branches = [], onDone }) {
  const C = useC();
  const { t } = useLang();
  const s = t.depletion;

  const [qty, setQty] = useState({});
  const [skip, setSkip] = useState({});
  const [branch, setBranch] = useState(branchId || branches[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  if (!plan?.movements?.length) return null;

  const rows = plan.movements.map((m, i) => ({
    ...m,
    qty: qty[i] !== undefined ? Number(qty[i]) : m.qty,
    skipped: Boolean(skip[i]),
  }));
  const live = rows.filter((r) => !r.skipped && r.qty > 0);

  const commit = async () => {
    if (!branch) { setFailed(true); setNote(s.pickBranch); return; }
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/stock?what=consume", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          branchId: branch,
          note: s.source,
          movements: live.map((r) => ({ ingredientId: r.ingredientId, qty: r.qty, unit: r.unit })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFailed(true);
        /* "Not enough of X" is the one refusal worth naming, because it is
           usually true and tells the kitchen something. */
        setNote(json.error === "negative"
          ? fill(s.errShort, { name: json.ingredientName || json.ingredientId || "" })
          : s.errServer);
        return;
      }
      setFailed(false);
      setDone(true);
      setNote(fill(s.done, { count: json.movements?.length || 0 }));
      onDone?.(json.movements || []);
    } catch {
      setFailed(true);
      setNote(s.errServer);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-5 md:p-6">
      <h3 className="display font-bold text-base mb-1 flex items-center gap-2">
        <PackageMinus size={15} style={{ color: C.iris }} /> {s.title}
      </h3>
      <p className="text-xs mb-3" style={{ color: C.slate }}>{s.lead}</p>

      {branches.length > 1 && (
        <div className="mb-3">
          <label htmlFor="depbranch" className="block text-[11px] font-bold uppercase tracking-wide mb-1"
            style={{ color: C.slate }}>
            {s.branch}
          </label>
          <select
            id="depbranch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-lg px-2.5 py-1.5 text-sm outline-none"
            style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
          >
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={`${r.ingredientId}-${r.unit}`}
            className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm"
            style={{ background: "var(--chip-bg)", opacity: r.skipped ? 0.45 : 1 }}>
            <input
              type="checkbox"
              checked={!r.skipped}
              onChange={(e) => setSkip((v) => ({ ...v, [i]: !e.target.checked }))}
              aria-label={r.name}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{r.name}</div>
              <div className="text-[11px] truncate" style={{ color: C.slate }}>{r.from.join(" · ")}</div>
            </div>
            <input
              type="number" min="0" step="any" inputMode="decimal" dir="ltr"
              value={r.qty}
              onChange={(e) => setQty((v) => ({ ...v, [i]: e.target.value }))}
              aria-label={s.qty}
              className="data text-xs shrink-0 w-20 text-end rounded px-1.5 py-1 outline-none"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}
            />
            <span className="data text-xs shrink-0 w-10" style={{ color: C.slate }} dir="ltr">{r.unit}</span>
          </div>
        ))}
      </div>

      {(plan.noRecipe?.length > 0 || plan.unmatched?.length > 0) && (
        <p className="text-[11px] mt-3 flex items-start gap-1.5" style={{ color: C.slate }}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {fill(s.partial, {
              items: [
                ...(plan.noRecipe || []).map((n) => n.menuItem),
                ...(plan.unmatched || []),
              ].join(", "),
            })}
          </span>
        </p>
      )}

      {note && (
        <p className="text-xs mt-3 flex items-center gap-1" style={{ color: failed ? C.rose : C.cyan }}>
          {!failed && <Check size={13} />} {note}
        </p>
      )}

      {!done && (
        <button
          type="button"
          onClick={commit}
          disabled={busy || !live.length}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <PackageMinus size={14} />}
          {busy ? s.saving : fill(s.commit, { count: live.length })}
        </button>
      )}
    </div>
  );
}
