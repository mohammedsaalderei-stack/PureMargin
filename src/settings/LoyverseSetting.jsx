import { useEffect, useState } from "react";
import { Link2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Loyverse, for a business that already sells on it.

   The owner pastes an access token; the server tries it before keeping it,
   so a wrong one is refused here with Loyverse's own reason. Everybody else
   in the business sees whether it is connected and nothing to change — a
   till belongs to the business, and only the owner connects it.

   The token never comes back from the server, so there is nothing here to
   show or copy once it is saved: replacing it means pasting a new one. */
export default function LoyverseSetting({ token, onChange }) {
  const C = useC();
  const { t } = useLang();
  const L = t.pos.loyverse;
  const [pos, setPos] = useState(null);
  const [names, setNames] = useState([]);
  const [form, setForm] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  const loadNames = async () => {
    try {
      const res = await fetch("/api/stores", { headers: auth });
      const json = await res.json();
      setNames((json.stores || []).filter((s) => s.pos && !s.archived).map((s) => s.name));
    } catch { /* the names are a courtesy */ }
  };

  const load = async () => {
    try {
      const res = await fetch("/api/account", { headers: auth });
      if (!res.ok) return;
      const json = await res.json();
      setPos(json.pos || null);
      if (json.pos?.connected) loadNames();
    } catch { /* no connection: the panel stays as it was */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const save = async (posToken) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account", {
        method: "PUT",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ posToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(L.errors[json.reason] || L.errors[json.error] || L.errors.generic);
        return;
      }
      setPos(json.pos || null);
      setNames(json.stores || []);
      setForm(false);
      setValue("");
      setConfirming(false);
      onChange?.();
    } catch {
      setError(L.errors.unreachable);
    } finally {
      setBusy(false);
    }
  };

  if (!pos) return null;
  /* A member of a business with no till connected has nothing to do here. */
  if (!pos.canConnect && !pos.connected) return null;

  const button = (label, onClick, { primary = false, danger = false, disabled = false } = {}) => (
    <button onClick={onClick} disabled={busy || disabled}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
      style={primary
        ? { background: C.iris, color: C.onPrimary }
        : { border: `1px solid ${danger ? C.rose : C.hairline}`, color: danger ? C.rose : C.slate }}>
      {busy && primary && <Loader2 size={14} className="animate-spin" />}{label}
    </button>
  );

  return (
    <div className="panel p-5 md:p-6" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={16} style={{ color: C.iris }} />
        <h3 className="display font-bold text-base">{L.title}</h3>
        {pos.connected && (
          <span className="ms-auto inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: C.irisWash, color: C.iris }}>
            <CheckCircle2 size={12} /> {L.connected}
          </span>
        )}
      </div>
      <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>
        {pos.connected ? L.connectedLead : L.lead}
      </p>

      {pos.lost && (
        <div className="flex gap-2 p-3 rounded-lg mb-3" style={{ border: `1px solid ${C.amber}` }}>
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: C.amber }} />
          <p className="text-xs" style={{ color: C.ink }}>{L.lost}</p>
        </div>
      )}

      {pos.connected && names.length > 0 && (
        <p className="text-xs mb-3" style={{ color: C.ink }}>{fill(L.stores, { names: names.join(", ") })}</p>
      )}
      {pos.viaOwner && <p className="text-xs mb-1" style={{ color: C.slate }}>{L.viaOwner}</p>}
      {pos.viaServer && pos.canConnect && <p className="text-xs mb-3" style={{ color: C.slate }}>{L.viaServer}</p>}

      {pos.canConnect && !form && !confirming && (
        <div className="flex flex-wrap gap-2">
          {button(pos.connected ? L.replace : L.connect, () => { setForm(true); setError(""); }, { primary: !pos.connected })}
          {pos.connected && button(L.disconnect, () => setConfirming(true), { danger: true })}
        </div>
      )}

      {confirming && (
        <div className="pt-1">
          <p className="text-xs mb-3 leading-relaxed" style={{ color: C.ink }}>{L.disconnectConfirm}</p>
          <div className="flex gap-2">
            {button(L.disconnect, () => save(""), { danger: true })}
            {button(L.cancel, () => setConfirming(false))}
          </div>
        </div>
      )}

      {form && (
        <div className="pt-1">
          <label className="block mb-2">
            <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{L.token}</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={L.placeholder}
              autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} dir="ltr"
              className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none data"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }} />
          </label>
          <p className="text-[11px] mb-1" style={{ color: C.slate }}>{L.where}</p>
          <p className="text-[11px] mb-3" style={{ color: C.slate }}>{L.note}</p>
          {error && <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>}
          <div className="flex gap-2">
            {button(busy ? L.connecting : L.connect, () => save(value.trim()), { primary: true, disabled: !value.trim() })}
            {button(L.cancel, () => { setForm(false); setValue(""); setError(""); })}
          </div>
        </div>
      )}
      {error && !form && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}
    </div>
  );
}
