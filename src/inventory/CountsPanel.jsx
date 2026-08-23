import { useEffect, useState } from "react";
import { Plus, ClipboardList } from "lucide-react";
import CountSheet from "./CountSheet.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Stock counts — the list, and the form that opens a new one.

   Counts are listed newest first across every branch the user may see, so a
   reviewer's queue is one place rather than a branch at a time. The sheet itself
   is a separate component: it is the screen somebody stands in front of with a
   clipboard, and it shouldn't re-render because a list above it refreshed.

   Opening a count is deliberately scoped — one category or one storage location.
   A sheet with four hundred lines on it is a count that never gets finished, and
   the document's "scheduled or spot" distinction is exactly this choice. */

const TONE = (C) => ({ draft: C.slate, review: C.iris, approved: C.mint || C.iris, cancelled: C.slate });

function OpenForm({ branches, branchNames, meta, busy, error, onOpen, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.counts;
  const [form, setForm] = useState({
    branchId: branches[0] || "", name: "", scopeBy: "all", value: "", spot: false,
  });

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const input = {
    className: "mt-1 w-full px-3 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };
  const label = (text) => <span className="text-xs font-medium" style={{ color: C.slate }}>{text}</span>;

  const options = form.scopeBy === "category" ? (meta?.categories || []) : (meta?.locations || []);

  const submit = (e) => {
    e.preventDefault();
    onOpen({
      branchId: form.branchId,
      name: form.name,
      spot: form.spot,
      category: form.scopeBy === "category" ? form.value : "",
      location: form.scopeBy === "location" ? form.value : "",
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2 mb-5 pb-5"
      style={{ borderBottom: `1px solid ${C.hairline}` }}>
      <label className="block">
        {label(s.branch)}
        <select {...input} value={form.branchId} onChange={set("branchId")}>
          {branches.map((b) => <option key={b} value={b}>{branchNames[b] || b}</option>)}
        </select>
      </label>

      <label className="block">
        {label(s.name)}
        <input {...input} value={form.name} onChange={set("name")} placeholder={s.namePlaceholder} />
      </label>

      <label className="block">
        {label(s.scope)}
        <select {...input} value={form.scopeBy}
          onChange={(e) => setForm((f) => ({ ...f, scopeBy: e.target.value, value: "" }))}>
          <option value="all">{s.scopeAll}</option>
          <option value="category">{s.scopeCategory}</option>
          <option value="location">{s.scopeLocation}</option>
        </select>
      </label>

      {form.scopeBy !== "all" && (
        <label className="block">
          {label(form.scopeBy === "category" ? s.scopeCategory : s.scopeLocation)}
          <select {...input} value={form.value} onChange={set("value")} required>
            <option value="">{s.choose}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      )}

      <label className="md:col-span-2 flex items-center gap-2 text-xs" style={{ color: C.slate }}>
        <input type="checkbox" checked={form.spot} onChange={set("spot")} style={{ accentColor: C.iris }} />
        {s.spotHint}
      </label>

      {error && <p className="md:col-span-2 text-sm" style={{ color: C.rose }}>{error}</p>}

      <div className="md:col-span-2 flex flex-wrap gap-2">
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          {s.openCount}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
          {t.inventory.cancel}
        </button>
      </div>
    </form>
  );
}

export default function CountsPanel({ token, onStockChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.counts;

  const [state, setState] = useState(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    const res = await fetch("/api/counts", { headers: auth });
    if (!res.ok) return;
    setState(await res.json());
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/counts?what=open", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) { setError(s.errors[out.error] || s.errors.failed); return; }
      setOpening(false);
      await load();
      /* Straight into the sheet: opening a count and then having to find it in a
         list is a step nobody wants. */
      setOpenId(out.count.id);
    } catch {
      setError(s.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const counts = state.counts || [];
  const branches = state.branches || [];
  const names = state.branchNames || {};

  return (
    <>
      <div className="panel p-5 md:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="display font-bold text-base">{s.title}</h3>
            <p className="text-xs mt-1" style={{ color: C.slate }}>{s.note}</p>
          </div>
          {state.canManage && !opening && branches.length > 0 && (
            <button onClick={() => { setOpening(true); setError(""); }}
              className="px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              style={{ background: C.iris, color: C.onPrimary }}>
              <Plus size={14} /> {s.newCount}
            </button>
          )}
        </div>

        {opening && (
          <OpenForm branches={branches} branchNames={names} meta={state.meta} busy={busy} error={error}
            onOpen={open} onCancel={() => { setOpening(false); setError(""); }} />
        )}

        {counts.length === 0 ? (
          <div className="text-center py-8">
            <ClipboardList size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
            <p className="text-sm" style={{ color: C.slate }}>{s.empty}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {counts.map((c) => (
              <button key={c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}
                className="w-full flex items-center gap-3 p-3 rounded-lg text-start"
                style={{
                  background: "var(--chip-bg)",
                  border: `1px solid ${openId === c.id ? C.iris : "transparent"}`,
                  opacity: c.status === "cancelled" ? 0.55 : 1,
                }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate-safe">{c.name || s.untitled}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: C.hairline, color: TONE(C)[c.status] || C.slate }}>
                      {s.statuses[c.status]}
                    </span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                    {[
                      names[c.branchId] || c.branchId,
                      c.category || c.location || s.scopeAll,
                      fill(s.progress, { counted: c.countedCount, lines: c.lineCount }),
                      new Date(c.openedAt).toLocaleDateString(),
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {openId && (
        <CountSheet token={token} id={openId} onClose={() => setOpenId(null)}
          onChanged={() => { load(); onStockChanged?.(); }} />
      )}
    </>
  );
}
