import { useState, useEffect } from "react";
import { KeyRound, Loader2, Check } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* Opening a tab somebody's role does not normally include.

   Two lists, because the two questions are different. "Every chef should see
   Leakage" is a statement about the job; "Fatima should see the table" is a
   statement about Fatima. Collapsing them into one picker would force the
   owner to repeat a role-wide decision once per person, and to remember to
   repeat it again the next time somebody is hired.

   The whole map is sent on every save rather than a delta. Removing a grant
   is then simply saving without it, which is the same gesture as adding one —
   a merge-only endpoint would need a second verb for taking things back, and
   that verb is the one nobody finds. */

function TabChips({ all, chosen, onToggle, labelFor, C }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((id) => {
        const on = chosen.includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            aria-pressed={on}
            className="px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors"
            style={{
              borderColor: on ? C.iris : C.hairline,
              background: on ? `${C.iris}1A` : "transparent",
              color: on ? C.iris : C.slate,
            }}
          >
            {labelFor(id)}
          </button>
        );
      })}
    </div>
  );
}

export default function ExtraAccess({ token, members = [], roles = [], grantable = [], initial }) {
  const C = useC();
  const { t } = useLang();
  const s = t.grants;

  const [byRole, setByRole] = useState({});
  const [byUser, setByUser] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setByRole(initial?.roles || {});
    setByUser(initial?.users || {});
  }, [initial]);

  const toggle = (map, setMap, key, id) => {
    const current = map[key] || [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setMap({ ...map, [key]: next });
  };

  /* Tab names come from the same dictionary the nav reads, so a granted tab is
     called on this screen exactly what it will be called when it appears. */
  const labelFor = (id) => t[id]?.tab || id;

  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roles: byRole, users: byUser }),
      });
      if (!res.ok) throw new Error("save");
      const json = await res.json();
      setByRole(json.grants?.roles || {});
      setByUser(json.grants?.users || {});
      setFailed(false);
      setNote(s.saved);
    } catch {
      setFailed(true);
      setNote(t.team.failed);
    } finally {
      setBusy(false);
    }
  };

  /* The owner is left out of the personal list: they already hold everything,
     so a row of chips that can only be switched on would say nothing. */
  const people = members.filter((m) => !m.isOwner);

  const nothingGiven =
    !Object.values(byRole).some((v) => v.length) && !Object.values(byUser).some((v) => v.length);

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: C.hairline }}>
      <div className="flex items-start gap-3">
        <KeyRound size={18} className="mt-0.5 shrink-0" style={{ color: C.iris }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold">{s.title}</h3>
          <p className="text-xs mt-0.5" style={{ color: C.slate }}>{s.lead}</p>

          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: C.slate }}>
              {s.byRole}
            </p>
            <div className="flex flex-col gap-3">
              {roles.filter((r) => r.key !== "owner").map((r) => (
                <div key={r.key}>
                  <p className="text-xs font-semibold mb-1.5">{t.roleNames?.[r.key] || r.label}</p>
                  <TabChips
                    all={grantable}
                    chosen={byRole[r.key] || []}
                    onToggle={(id) => toggle(byRole, setByRole, r.key, id)}
                    labelFor={labelFor}
                    C={C}
                  />
                </div>
              ))}
            </div>
          </div>

          {people.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: C.slate }}>
                {s.byPerson}
              </p>
              <div className="flex flex-col gap-3">
                {people.map((m) => (
                  <div key={m.username}>
                    <p className="text-xs font-semibold mb-1.5">
                      <span dir="ltr">{m.username}</span>
                      <span className="font-normal" style={{ color: C.slate }}>
                        {" · "}{t.roleNames?.[m.role] || m.roleLabel}
                      </span>
                    </p>
                    <TabChips
                      all={grantable}
                      chosen={byUser[m.username] || []}
                      onToggle={(id) => toggle(byUser, setByUser, m.username, id)}
                      labelFor={labelFor}
                      C={C}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {nothingGiven && (
            <p className="text-[11px] mt-4" style={{ color: C.slate }}>{s.none}</p>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {busy ? s.saving : s.save}
            </button>
            {note && (
              <span className="text-xs flex items-center gap-1" style={{ color: failed ? C.rose : C.cyan }}>
                {!failed && <Check size={13} />} {note}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
