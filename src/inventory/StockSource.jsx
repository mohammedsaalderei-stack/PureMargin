import { useState, useEffect } from "react";
import { Boxes, Radio, AlertTriangle } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Where stock is kept: here, or on the till.

   Some tills track inventory and some do not, and the ones that do track a
   different thing from what a kitchen needs — a count against a catalogue
   item, not an ingredient with a unit, a pack size, a supplier and a cost per
   unit taken from what was actually paid.

   So this is a choice with a cost either way, and the screen states it rather
   than presenting two unlabelled options. What the till cannot do comes from
   the till's own adapter, so a business on a different POS is told about that
   POS instead of about Loyverse.

   They are alternatives, not settings that combine. Both sides deducting the
   same sale would halve the balance twice as fast, so choosing the till turns
   automatic depletion off — said here, on the switch, rather than discovered
   later as a number falling at the wrong rate. */

export default function StockSource({ token, meta, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.stocksource;

  const [support, setSupport] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/inventory?what=possupport", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSupport)
      .catch(() => {});
  }, [token]);

  const current = meta?.stockSource === "pos" ? "pos" : "puremargin";

  const choose = async (next) => {
    if (next === current) return;
    setBusy(true);
    try {
      await fetch("/api/inventory?what=meta", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stockSource: next }),
      });
      onChanged?.();
    } catch { /* the next load shows what actually stuck */ } finally { setBusy(false); }
  };

  /* Nothing to choose between until the till says it keeps stock, and a switch
     with one working side is just a disabled control taking up room. */
  if (!support?.supported) return null;

  const Option = ({ id, icon: Icon, title, body, children }) => {
    const on = current === id;
    return (
      <button
        type="button"
        onClick={() => choose(id)}
        disabled={busy}
        className="w-full text-start rounded-xl p-4 disabled:opacity-60"
        style={{
          border: `1px solid ${on ? C.iris : C.hairline}`,
          background: on ? C.irisWash : "transparent",
        }}
        aria-pressed={on}
      >
        <span className="flex items-center gap-2 font-semibold text-sm">
          <Icon size={15} style={{ color: on ? C.iris : C.slate }} />
          {title}
        </span>
        <span className="block text-xs mt-1" style={{ color: C.slate }}>{body}</span>
        {children}
      </button>
    );
  };

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: C.hairline }}>
      <h3 className="text-sm font-bold">{s.title}</h3>
      <p className="text-xs mt-0.5 mb-3" style={{ color: C.slate }}>{s.lead}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <Option id="puremargin" icon={Boxes} title={s.hereTitle} body={s.hereBody} />

        <Option id="pos" icon={Radio}
          title={fill(s.posTitle, { pos: support.label })}
          body={fill(s.posBody, { pos: support.label })}
        >
          {/* Named by the adapter, so a business on another till is told about
              that till rather than about somebody else's. */}
          <span className="block mt-2 space-y-1">
            {(support.limits || []).map((k) => (
              <span key={k} className="flex items-start gap-1.5 text-[11px]" style={{ color: C.rose }}>
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {s.limits[k] || k}
              </span>
            ))}
          </span>
        </Option>
      </div>

      {current === "pos" && (
        <p className="text-[11px] mt-3" style={{ color: C.slate }}>{s.posChosen}</p>
      )}
    </section>
  );
}
