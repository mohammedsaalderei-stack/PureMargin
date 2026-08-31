import { useState, useEffect } from "react";
import { Building2, Plus, Loader2, X } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* The money that goes out whether the room is full or empty.

   Rent, salaries, a licence, the internet. Everything else this product
   measures moves with trade; these do not, and leaving them out meant the
   headline said "net" while showing gross — flattering on a slow month by
   exactly the amount that should have worried somebody.

   Kept on the same screen as the scanned bills deliberately. They are the two
   halves of what a month costs, and splitting them across two tabs is how
   somebody ends up believing one of them is the whole picture. */

const PERIODS = ["monthly", "weekly", "yearly"];

export default function FixedCosts({ token, from, to, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.fixedcosts;

  const [state, setState] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", amount: "", period: "monthly" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const qs = from && to ? `?from=${from}&to=${to}` : "";
      const res = await fetch(`/api/fixedcosts${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setState(await res.json());
    } catch { /* the panel stays empty; the rest of the screen is unaffected */ }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const save = async () => {
    if (!draft.name.trim() || !(Number(draft.amount) > 0)) { setError(s.errFields); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/fixedcosts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: draft.name.trim(),
          amount: Number(draft.amount),
          period: draft.period,
        }),
      });
      if (!res.ok) { setError(s.errServer); return; }
      setDraft({ name: "", amount: "", period: "monthly" });
      setAdding(false);
      await load();
      onChanged?.();
    } catch { setError(s.errServer); } finally { setBusy(false); }
  };

  /* Ended rather than deleted. Rent that stopped in March still applied in
     February, and a report over February has to keep costing it. */
  const stop = async (id) => {
    try {
      await fetch(`/api/fixedcosts?id=${encodeURIComponent(id)}&end=1`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      await load();
      onChanged?.();
    } catch { setError(s.errServer); }
  };

  const costs = state?.costs || [];
  const window = state?.window || { total: 0, lines: [] };
  const mayWrite = state?.mayWrite !== false;

  const field = {
    className: "rounded-lg px-2.5 py-1.5 text-sm outline-none",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  return (
    <div className="panel p-5 md:p-6">
      <h3 className="display font-bold text-base mb-1 flex items-center gap-2">
        <Building2 size={15} style={{ color: C.iris }} /> {s.title}
      </h3>
      <p className="text-xs mb-4" style={{ color: C.slate }}>{s.lead}</p>

      {costs.length === 0 && !adding && (
        <p className="text-sm mb-3" style={{ color: C.slate }}>{s.empty}</p>
      )}

      {costs.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {costs.map((c) => {
            const share = window.lines.find((l) => l.id === c.id);
            return (
              <div key={c.id} className="flex items-center gap-3 py-2 px-3 rounded-lg text-sm"
                style={{ background: "var(--chip-bg)" }}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-[11px]" style={{ color: C.slate }}>
                    <Money value={c.amount} /> · {s.periods[c.period]}
                  </div>
                </div>
                {/* What it comes to over the period on screen, which is the
                    number that actually reaches the margin. */}
                {share && (
                  <span className="data text-xs shrink-0" style={{ color: C.slate }}>
                    <Money value={share.amount} />
                  </span>
                )}
                {mayWrite && (
                  <button type="button" onClick={() => stop(c.id)} aria-label={s.stop}
                    className="shrink-0 p-1 rounded" style={{ color: C.slate }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {window.total > 0 && (
        <div className="flex justify-between items-baseline py-2 px-3 rounded-lg mb-3"
          style={{ background: C.irisWash }}>
          <span className="text-xs font-semibold">{s.overPeriod}</span>
          <span className="data font-bold"><Money value={window.total} /></span>
        </div>
      )}

      {adding && (
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <input
            {...field}
            className={`${field.className} flex-1 min-w-[9rem]`}
            placeholder={s.namePlaceholder}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            {...field} type="number" min="0" step="any" inputMode="decimal" dir="ltr"
            className={`${field.className} w-28 text-end`}
            placeholder={s.amountPlaceholder}
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          />
          <select {...field} value={draft.period}
            onChange={(e) => setDraft({ ...draft, period: e.target.value })}>
            {PERIODS.map((p) => <option key={p} value={p}>{s.periods[p]}</option>)}
          </select>
          <button type="button" onClick={save} disabled={busy}
            className="px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
            style={{ background: C.iris, color: C.onPrimary }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : s.save}
          </button>
        </div>
      )}

      {error && <p className="text-xs mb-2" style={{ color: C.rose }}>{error}</p>}

      {mayWrite && !adding && (
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: C.iris }}>
          <Plus size={13} /> {s.add}
        </button>
      )}

      <p className="text-[11px] mt-3" style={{ color: C.slate }}>{s.apportionHint}</p>
    </div>
  );
}
