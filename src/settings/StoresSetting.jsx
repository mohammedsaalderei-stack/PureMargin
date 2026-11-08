import { useEffect, useState } from "react";
import { Store, Plus, Pencil, Archive, RotateCcw, Loader2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* The business's stores — its branches — added here rather than read from
   somebody else's till.

   Only the owner sees the controls; everybody else sees nothing, since a
   list they cannot change is already in the scope selector. A store is
   archived rather than deleted, because its receipts, stock and staff
   assignments all point at it. */

const EMPTY = { name: "", address: "", phone: "", trn: "" };

export default function StoresSetting({ token }) {
  const C = useC();
  const { t } = useLang();
  const S = t.pos.stores;
  const [stores, setStores] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const call = async (method, body) => {
    const res = await fetch("/api/stores", {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || "generic"), { code: json.error });
    return json;
  };

  const load = async () => {
    try {
      const out = await call("GET");
      setStores(out.stores || []);
      setCanManage(Boolean(out.canManage));
    } catch { /* the panel stays hidden */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const run = async (method, body) => {
    setBusy(true);
    setError("");
    try {
      await call(method, body);
      setForm(null);
      await load();
    } catch (err) {
      setError(S.errors[err.code] || S.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) return null;

  const input = (key, extra = {}) => (
    <label className="block mb-3">
      <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{S[key]}</span>
      <input value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none"
        style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }} {...extra} />
    </label>
  );

  return (
    <div className="panel p-5 md:p-6" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="display font-bold text-base">{S.title}</h3>
        {!form && (
          <button onClick={() => { setForm({ ...EMPTY }); setError(""); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
            style={{ background: C.irisWash, color: C.iris }}>
            <Plus size={13} /> {S.add}
          </button>
        )}
      </div>
      <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>{S.lead}</p>

      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.hairline}` }}>
        {stores.map((st, i) => (
          <div key={st.id} className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: i ? `1px solid ${C.hairline}` : "none", opacity: st.archived ? 0.55 : 1 }}>
            <Store size={17} style={{ color: C.iris }} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">
                {st.name}
                {st.archived && <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--chip-bg)", color: C.slate }}>{S.archived}</span>}
              </div>
              {(st.address || st.trn) && (
                <div className="text-xs truncate" style={{ color: C.slate }}>{[st.address, st.trn && `TRN ${st.trn}`].filter(Boolean).join(" · ")}</div>
              )}
            </div>
            {!st.archived && (
              <button onClick={() => { setForm({ ...EMPTY, ...st }); setError(""); }} aria-label={S.edit}
                className="p-2 rounded-lg" style={{ color: C.slate }}><Pencil size={15} /></button>
            )}
            <button onClick={() => run("PATCH", { id: st.id, archived: !st.archived })} disabled={busy}
              aria-label={st.archived ? S.restore : S.archive} className="p-2 rounded-lg" style={{ color: C.slate }}>
              {st.archived ? <RotateCcw size={15} /> : <Archive size={15} />}
            </button>
          </div>
        ))}
      </div>

      {error && !form && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

      {form && (
        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
          {input("name", { autoFocus: true, maxLength: 60 })}
          {input("address", { maxLength: 120 })}
          <div className="grid sm:grid-cols-2 gap-x-3">
            {input("phone", { inputMode: "tel", dir: "ltr", maxLength: 30 })}
            {input("trn", { inputMode: "numeric", dir: "ltr", maxLength: 20 })}
          </div>
          <p className="text-[11px] -mt-1 mb-3" style={{ color: C.slate }}>{S.optional}</p>
          {error && <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => run("POST", form)} disabled={busy || !form.name.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: C.iris, color: C.onPrimary }}>
              {busy && <Loader2 size={14} className="animate-spin" />}{S.save}
            </button>
            <button onClick={() => { setForm(null); setError(""); }} className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>{S.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
