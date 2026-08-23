import { useEffect, useState } from "react";
import { Check, Send, Undo2, X, AlertTriangle } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* One count sheet — stage 4, phase 3.

   The sheet shows what the ledger expected beside a box for what is actually
   there, and nothing else competes for attention: counting is done standing up,
   often on a phone, and every extra control is a line that doesn't get counted.

   Two behaviours are deliberate. An empty box stays empty — it is saved as "not
   counted", never as zero, because writing off a shelf is not something a blank
   field should be able to do. And a variance only asks for a reason once it
   exists, since a reason on a line that matches is noise in the report that
   groups by them.

   Which controls appear follows the server's answer, not a guess: `canManage`
   fills the sheet in, `canApprove` signs it off. The chef who counted sees no
   approve button because their role doesn't carry it. */

const STATUS_TONE = (C) => ({
  draft: C.slate,
  review: C.iris,
  approved: C.mint || C.iris,
  cancelled: C.slate,
});

/* Two decimals rather than the app's usual whole dirhams: a variance of 40 fils
   on a line is still a variance, and rounding it to nothing would make a row
   that clearly differs look like it balanced. */
function Money({ value }) {
  const C = useC();
  if (value === null || value === undefined) return <span style={{ color: C.slate }}>—</span>;
  return (
    <span className="tabular-nums inline-flex items-baseline gap-[0.22em]" dir="ltr"
      style={{ color: value < 0 ? C.rose : C.ink }}>
      {value < 0 ? "−" : "+"}
      <DirhamMark />
      <span>{Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
    </span>
  );
}

export default function CountSheet({ token, id, onClose, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.counts;

  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Local edits, so typing doesn't wait on a round trip per keystroke. */
  const [edits, setEdits] = useState({});

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    const res = await fetch(`/api/counts?what=count&id=${encodeURIComponent(id)}`, { headers: auth });
    if (!res.ok) { setError(s.errors.failed); return; }
    setState(await res.json());
    setEdits({});
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function post(what, body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/counts?what=${what}`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const out = await res.json();
      if (!res.ok) { setError(s.errors[out.error] || s.errors.failed); return false; }
      await load();
      onChanged?.();
      return true;
    } catch {
      setError(s.errors.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /* Everything typed since the last save, sent in one request. */
  const saveEdits = async () => {
    const lines = Object.entries(edits).map(([ingredientId, e]) => ({ ingredientId, ...e }));
    if (!lines.length) return true;
    return post("lines", { lines });
  };

  if (!state) return null;

  const count = state.count;
  const lines = count.lines || [];
  const totals = count.totals || {};
  const editable = count.status === "draft" && state.canManage;
  const tone = STATUS_TONE(C)[count.status] || C.slate;

  const num = (n, digits = 4) =>
    n === null || n === undefined ? "—" : Number(n.toFixed(digits)).toLocaleString();

  const setLine = (ingredientId, patch) =>
    setEdits((e) => ({ ...e, [ingredientId]: { ...e[ingredientId], ...patch } }));

  const valueOf = (line, key) =>
    edits[line.ingredientId]?.[key] !== undefined ? edits[line.ingredientId][key] : line[key];

  return (
    <div className="panel p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="display font-bold text-base truncate-safe">
              {count.name || s.untitled}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
              style={{ background: C.hairline, color: tone }}>
              {s.statuses[count.status]}
            </span>
            {count.spot && (
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ background: C.hairline, color: C.slate }}>{s.spot}</span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: C.slate }}>
            {[
              fill(s.openedBy, { who: count.openedBy, when: new Date(count.openedAt).toLocaleString() }),
              count.approvedBy ? fill(s.approvedBy, { who: count.approvedBy }) : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover-soft shrink-0" style={{ color: C.slate }}>
          <X size={14} />
        </button>
      </div>

      {/* The reviewer's summary. Shrink and gain stay apart — a net figure would
          say a shelf short on meat and long on flour was fine. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {[
          { label: s.counted, value: `${totals.counted ?? 0} / ${totals.lines ?? lines.length}` },
          { label: s.shrink, money: totals.shrinkValue },
          { label: s.gain, money: totals.gainValue },
          { label: s.net, money: totals.netValue },
        ].map((box) => (
          <div key={box.label} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{box.label}</div>
            <div className="text-sm font-bold mt-0.5">
              {box.money !== undefined ? <Money value={box.money} /> : box.value}
            </div>
          </div>
        ))}
      </div>

      {totals.unpriced > 0 && (
        <p className="text-[11px] mb-3 inline-flex items-center gap-1.5" style={{ color: C.slate }}>
          <AlertTriangle size={11} /> {fill(s.unpriced, { n: totals.unpriced })}
        </p>
      )}

      <div className="space-y-1.5">
        {lines.map((line) => {
          const counted = valueOf(line, "countedQty");
          const hasVariance = line.countedQty !== null && Math.abs(line.varianceBase || 0) > 1e-9;
          return (
            <div key={line.ingredientId} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate-safe">{line.name}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: C.slate }} dir="ltr">
                    {s.expected}: {num(line.expectedQty ?? 0)} {line.stockUnit}
                  </div>
                </div>

                {editable ? (
                  <input
                    type="number" min="0" step="any" dir="ltr"
                    className="w-24 px-2 py-1.5 rounded-lg text-sm text-end"
                    style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
                    value={counted === null || counted === undefined ? "" : counted}
                    placeholder={s.notCounted}
                    /* An empty box is "not counted", never zero. */
                    onChange={(e) => setLine(line.ingredientId, {
                      countedQty: e.target.value === "" ? null : e.target.value,
                    })}
                    onBlur={saveEdits}
                  />
                ) : (
                  <div className="text-sm font-bold tabular-nums" dir="ltr">
                    {line.countedQty === null
                      ? <span style={{ color: C.slate }}>{s.notCounted}</span>
                      : `${num(line.countedQty)} ${line.unit}`}
                  </div>
                )}

                <div className="w-28 text-end shrink-0">
                  {line.countedQty !== null && (
                    <>
                      <div className="text-xs font-semibold tabular-nums" dir="ltr"
                        style={{ color: hasVariance ? (line.varianceBase < 0 ? C.rose : C.ink) : C.slate }}>
                        {hasVariance ? `${line.varianceQty > 0 ? "+" : ""}${num(line.varianceQty)} ${line.stockUnit}` : s.match}
                      </div>
                      {hasVariance && (
                        <div className="text-[11px]"><Money value={line.varianceValue} /></div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* A reason is asked for only where there is something to explain. */}
              {hasVariance && (
                <div className="mt-2">
                  {editable ? (
                    <select
                      className="w-full px-2 py-1.5 rounded-lg text-xs"
                      style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
                      value={valueOf(line, "reason") || ""}
                      onChange={(e) => { setLine(line.ingredientId, { reason: e.target.value }); }}
                      onBlur={saveEdits}
                    >
                      <option value="">{s.chooseReason}</option>
                      {(state.reasons || []).map((r) => (
                        <option key={r} value={r}>{s.reasons[r] || r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[11px]" style={{ color: C.slate }}>
                      {line.reason ? (s.reasons[line.reason] || line.reason) : s.noReason}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

      <div className="flex flex-wrap gap-2 mt-4">
        {count.status === "draft" && state.canManage && (
          <button onClick={async () => { if (await saveEdits()) post("submit", {}); }} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: C.iris, color: C.onPrimary }}>
            <Send size={14} /> {s.submit}
          </button>
        )}

        {count.status === "review" && state.canApprove && (
          <>
            <button onClick={() => post("approve", {})} disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              style={{ background: C.iris, color: C.onPrimary }}>
              <Check size={14} /> {s.approve}
            </button>
            <button onClick={() => post("reopen", {})} disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              <Undo2 size={14} /> {s.reopen}
            </button>
          </>
        )}

        {count.status === "review" && !state.canApprove && (
          <p className="text-xs self-center" style={{ color: C.slate }}>{s.awaitingApproval}</p>
        )}

        {count.status !== "approved" && count.status !== "cancelled" && state.canManage && (
          <button onClick={() => { if (window.confirm(s.cancelConfirm)) post("cancel", {}); }} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
            {s.cancel}
          </button>
        )}

        {count.status === "approved" && (
          <p className="text-xs self-center" style={{ color: C.slate }}>
            {fill(s.approvedNote, { n: (count.movementIds || []).length })}
          </p>
        )}
      </div>
    </div>
  );
}
