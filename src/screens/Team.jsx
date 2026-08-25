import { useEffect, useState } from "react";
import { UserPlus, Trash2, ShieldCheck, Clock } from "lucide-react";
import TeamActivity from "../TeamActivity.jsx";
import { useC } from "../theme.jsx";
import ExtraAccess from "../settings/ExtraAccess.jsx";
import { useLang } from "../i18n.jsx";

/* Organization members, their roles, and the branches each one may see.

   Only reachable by an owner — the server gates every call on "manage:users",
   so this screen is the convenient path to that, never the thing that grants
   it. A branch manager who guesses the URL still gets a 403.

   Branch assignment is only offered for roles that are scoped to assigned
   branches. An owner covers the whole organization by definition, so showing
   them a branch picker would suggest a restriction that doesn't exist. */

function Panel({ title, children, note }) {
  const C = useC();
  return (
    <div className="panel p-5 md:p-6">
      <div className="mb-4">
        <h3 className="display font-bold text-base">{title}</h3>
        {note && <p className="text-xs mt-1" style={{ color: C.slate }}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Team({ token }) {
  const C = useC();
  const { t } = useLang();
  const [state, setState] = useState(null);
  const [branches, setBranches] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("cashier");
  const [invitedMsg, setInvitedMsg] = useState("");
  const [picked, setPicked] = useState([]);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    try {
      const [teamRes, scopeRes] = await Promise.all([
        fetch("/api/team", { headers: auth }),
        fetch("/api/scope", { headers: auth }),
      ]);
      if (!teamRes.ok) { setError(t.team.forbidden); return; }
      setState(await teamRes.json());
      if (scopeRes.ok) setBranches((await scopeRes.json()).branches || []);
    } catch {
      setError(t.team.failed);
    }
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true); setError(""); setInvitedMsg("");
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, branches: picked }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(t.team.errors[json.error] || t.team.failed); return; }
      setInvitedMsg(json.joined ? t.team.joinedNow : t.team.inviteSent);
      setEmail(""); setPicked([]);
      await load();
    } finally { setBusy(false); }
  };

  const revokeInvite = async (address) => {
    setBusy(true);
    try {
      await fetch(`/api/team?email=${encodeURIComponent(address)}`, { method: "DELETE", headers: auth });
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (name) => {
    setBusy(true);
    try {
      await fetch(`/api/team?username=${encodeURIComponent(name)}`, { method: "DELETE", headers: auth });
      await load();
    } finally { setBusy(false); }
  };

  const scopedRole = (key) => state?.roles.find((r) => r.key === key)?.scope === "assigned";
  const nameFor = (id) => branches.find((b) => b.id === id)?.name || id;

  if (error && !state) {
    return (
      <div className="h-full grid place-items-center px-6">
        <p className="text-sm text-center" style={{ color: C.slate }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <h2 className="display text-2xl md:text-3xl font-extrabold">{t.team.title}</h2>
        <p className="text-sm" style={{ color: C.slate }}>{t.team.lead}</p>

        <Panel title={t.team.members} note={t.team.membersNote}>
          <div className="space-y-2">
            {(state?.members || []).map((m) => (
              <div key={m.username} className="flex items-start gap-3 p-3 rounded-lg"
                style={{ background: "var(--chip-bg)" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{m.username}</span>
                    {m.isOwner && <ShieldCheck size={13} style={{ color: C.iris }} title={t.team.ownerTag} />}
                    {m.pending && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: C.lilacWash, color: C.slate }}>
                        <Clock size={10} />{t.team.pending}
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: C.slate }}>
                    {m.roleLabel}
                    {" · "}
                    {m.scope === "all"
                      ? t.scope.all
                      : m.branches.length
                        ? m.branches.map(nameFor).join(", ")
                        : t.team.noBranches}
                  </p>
                </div>
                {!m.isOwner && (
                  <button onClick={() => remove(m.username)} disabled={busy}
                    className="shrink-0 p-1.5 rounded-lg" style={{ color: C.rose }}
                    aria-label={t.team.remove} title={t.team.remove}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>

        {(state?.invites || []).length > 0 && (
          <Panel title={t.team.pendingTitle} note={t.team.pendingNote}>
            <div className="space-y-1.5">
              {state.invites.map((inv) => (
                <div key={inv.email} className="flex items-center gap-3 py-2 px-3 rounded-lg text-sm"
                  style={{ background: "var(--chip-bg)" }}>
                  <Clock size={13} style={{ color: C.slate }} />
                  <span className="flex-1 min-w-0 truncate" dir="ltr">{inv.email}</span>
                  <span className="text-[11px]" style={{ color: C.slate }}>
                    {state?.roles?.find((r) => r.key === inv.role)?.label || inv.role}
                  </span>
                  <button onClick={() => revokeInvite(inv.email)} disabled={busy}
                    className="p-1 rounded-lg" style={{ color: C.rose }} title={t.team.revoke}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title={t.team.addTitle} note={t.team.addNote}>
          <div className="space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t.team.emailPlaceholder} autoComplete="off" type="email" dir="ltr"
              className="w-full px-3 py-2 rounded-lg text-sm text-start"
              style={{ border: `1px solid ${C.hairline}`, background: "transparent", color: C.ink }} />

            <select value={role} onChange={(e) => { setRole(e.target.value); setPicked([]); }}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: `1px solid ${C.hairline}`, background: "transparent", color: C.ink }}>
              {(state?.roles || []).filter((r) => r.key !== "owner").map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>

            {scopedRole(role) && (
              <div>
                <p className="text-xs mb-2" style={{ color: C.slate }}>{t.team.branchesLabel}</p>
                {branches.length === 0 ? (
                  <p className="text-xs" style={{ color: C.slate }}>{t.team.noBranchesYet}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {branches.map((b) => {
                      const on = picked.includes(b.id);
                      return (
                        <button key={b.id} type="button"
                          onClick={() => setPicked(on ? picked.filter((x) => x !== b.id) : [...picked, b.id])}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium"
                          style={{
                            border: `1px solid ${on ? C.iris : C.hairline}`,
                            background: on ? C.irisWash : "transparent",
                            color: on ? C.ink : C.slate,
                          }}>
                          {b.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-xs" style={{ color: C.rose }}>{error}</p>}
            {invitedMsg && <p className="text-xs" style={{ color: C.iris }}>{invitedMsg}</p>}

            <button onClick={save} disabled={busy || !email.includes("@")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
              style={{ background: C.iris, color: C.onPrimary }}>
              <UserPlus size={14} />{t.team.invite}
            </button>

            <p className="text-[11px]" style={{ color: C.slate }}>{t.team.planNote}</p>
          </div>
        </Panel>

        {/* Exceptions to the role model, kept next to the roles themselves so
            the two are read together rather than one being discovered later. */}
        <ExtraAccess
          token={token}
          members={state?.members || []}
          roles={state?.roles || []}
          grantable={state?.grantableTabs || []}
          initial={state?.grants}
        />

        {/* Read-only history: what the app did with the POS, and what people did
            with permissions. Same owner-only gate as the rest of this screen. */}
        <TeamActivity
          syncs={state?.syncs || []}
          audit={state?.audit || []}
          actions={t.activity.actions}
        />
      </div>
    </div>
  );
}
