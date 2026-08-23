import { useEffect, useState } from "react";
import { Plus, Boxes, AlertTriangle, RotateCcw, ScrollText } from "lucide-react";
import MovementForm from "./MovementForm.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Stock on hand, and the ledger it comes from — stage 4, phase 2.

   Every quantity on this panel is a sum, never a stored field, and the panel is
   built so that is visible rather than claimed: each row expands into the
   entries that produced it, and the only way to change a number is to add
   another entry. There is deliberately no edit button and no delete button, in
   the interface as well as in the API.

   Branch scope comes from the server, which has already reduced it to what this
   user may see. An owner therefore reads one consolidated column with the
   per-branch split beside it, while a branch manager sees their branch — the same
   computation, not a different screen. */

function Row({ row, branches, branchNames, expanded, onToggle }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.stock;

  /* Trailing zeros on a derived number read as false precision; four decimals is
     enough to show that 250 g of a kilogram-held item is 0.25. */
  const fmt = (n) => Number(n.toFixed(4)).toLocaleString();
  const flagged = row.negative || row.belowReorder;

  return (
    <div className="rounded-lg" style={{ background: "var(--chip-bg)" }}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate-safe">{row.name}</span>
            {flagged && (
              <span className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                style={{ background: C.hairline, color: row.negative ? C.rose : C.amber || C.slate }}>
                <AlertTriangle size={10} />
                {row.negative ? s.negative : s.belowReorder}
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>
            {[row.category, branches.length > 1 ? fill(s.acrossBranches, { n: Object.keys(row.byBranch).length }) : null]
              .filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-end shrink-0">
          <div className="text-sm font-bold tabular-nums" style={{ color: row.negative ? C.rose : C.ink }} dir="ltr">
            {fmt(row.qty)} {row.stockUnit}
          </div>
          {row.reorderPoint !== null && row.reorderPoint !== undefined && (
            <div className="text-[10px] tabular-nums" style={{ color: C.slate }} dir="ltr">
              ⌂ {fmt(row.reorderPoint)}
            </div>
          )}
        </div>
      </button>

      {expanded && branches.length > 1 && (
        <div className="px-3 pb-3 space-y-1">
          {branches.map((b) => (
            <div key={b} className="flex items-center justify-between text-[11px]" style={{ color: C.slate }}>
              <span className="truncate-safe">{branchNames[b] || b}</span>
              <span className="tabular-nums" dir="ltr">{fmt(row.byBranch[b] || 0)} {row.stockUnit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Ledger({ token, branchId, branchName, canManage, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.stock;
  const [movements, setMovements] = useState(null);
  const [busy, setBusy] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    const res = await fetch(`/api/stock?what=ledger&branch=${encodeURIComponent(branchId)}`, { headers: auth });
    setMovements(res.ok ? (await res.json()).movements : []);
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function reverse(id) {
    if (!window.confirm(s.reverseConfirm)) return;
    setBusy(true);
    try {
      await fetch("/api/stock?what=reverse", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, id }),
      });
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  if (!movements) return null;

  return (
    <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
      <div className="text-xs font-semibold mb-2">{fill(s.ledgerFor, { name: branchName })}</div>
      {movements.length === 0 ? (
        <p className="text-xs" style={{ color: C.slate }}>{s.ledgerEmpty}</p>
      ) : (
        <div className="space-y-1">
          {movements.map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-[11px] py-1.5"
              style={{ color: C.slate, opacity: m.reversedBy ? 0.5 : 1 }}>
              <span className="tabular-nums shrink-0" dir="ltr">
                {new Date(m.at).toLocaleDateString()}
              </span>
              <span className="min-w-0 flex-1 truncate-safe" style={{ color: C.ink }}>
                {m.ingredientName}
                <span style={{ color: C.slate }}> · {s.types[m.type] || m.type}</span>
                {m.reverses && <span style={{ color: C.slate }}> · {s.reversal}</span>}
                {m.reversedBy && <span style={{ color: C.slate }}> · {s.reversed}</span>}
              </span>
              <span className="tabular-nums shrink-0" dir="ltr"
                style={{ color: m.qtyBase < 0 ? C.rose : C.ink }}>
                {m.qty > 0 ? "+" : ""}{Number(m.qty.toFixed(4))} {m.unit}
              </span>
              {/* Reversal is the only correction, so it is the only control. */}
              {canManage && !m.reversedBy && !m.reverses && (
                <button onClick={() => reverse(m.id)} disabled={busy} title={s.reverse}
                  className="p-1 rounded hover-soft shrink-0" style={{ color: C.slate }}>
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StockPanel({ token, ingredients }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.stock;

  const [state, setState] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [ledgerFor, setLedgerFor] = useState(null);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    const res = await fetch("/api/stock", { headers: auth });
    if (!res.ok) return;
    setState(await res.json());
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function record(payload) {
    setBusy(true);
    setFormError("");
    try {
      const what = payload.transfer ? "transfer" : "movement";
      const res = await fetch(`/api/stock?what=${what}`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json();
      if (!res.ok) {
        /* The server names the field or the condition; the wording — including
           how short the branch is — belongs to the interface, in the user's
           language. */
        setFormError(
          out.error === "negative"
            ? fill(s.errors.negative, {
                onHand: Number((out.onHand ?? 0).toFixed(4)),
                short: Number((out.short ?? 0).toFixed(4)),
              })
            : s.errors[out.error] || s.errors.failed
        );
        return;
      }
      setAdding(false);
      await load();
    } catch {
      setFormError(s.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const branches = state.branches || [];
  const names = state.branchNames || {};
  const rows = state.rows || [];
  const live = (ingredients || []).filter((i) => !i.archived);

  return (
    <div className="panel p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="display font-bold text-base">{s.title}</h3>
          <p className="text-xs mt-1" style={{ color: C.slate }}>
            {fill(s.note, { n: branches.length, m: rows.length })}
          </p>
        </div>
        {state.canManage && !adding && live.length > 0 && branches.length > 0 && (
          <button onClick={() => { setAdding(true); setFormError(""); }}
            className="px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
            style={{ background: C.iris, color: C.onPrimary }}>
            <Plus size={14} /> {s.record}
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-5 pb-5" style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <p className="text-xs mb-3" style={{ color: C.slate }}>{s.recordNote}</p>
          <MovementForm
            ingredients={live}
            branches={branches}
            branchNames={names}
            types={state.types}
            units={state.units}
            busy={busy}
            error={formError}
            onSubmit={record}
            onCancel={() => { setAdding(false); setFormError(""); }}
          />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-8">
          <Boxes size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
          <p className="text-sm" style={{ color: C.slate }}>{s.empty}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <Row key={row.ingredientId} row={row} branches={branches} branchNames={names}
              expanded={expanded === row.ingredientId}
              onToggle={() => setExpanded(expanded === row.ingredientId ? null : row.ingredientId)} />
          ))}
        </div>
      )}

      {branches.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {branches.map((b) => (
            <button key={b} onClick={() => setLedgerFor(ledgerFor === b ? null : b)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5"
              style={{
                border: `1px solid ${ledgerFor === b ? C.iris : C.hairline}`,
                color: ledgerFor === b ? C.iris : C.slate,
              }}>
              <ScrollText size={11} /> {names[b] || b}
            </button>
          ))}
        </div>
      )}

      {ledgerFor && (
        <Ledger token={token} branchId={ledgerFor} branchName={names[ledgerFor] || ledgerFor}
          canManage={state.canManage} onChanged={load} />
      )}
    </div>
  );
}
