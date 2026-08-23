import { Activity, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang, fill } from "./i18n.jsx";

/* The two logs an owner can read: what the app did with the POS, and what
   people did with permissions.

   Both are read-only and deliberately plain. A log that can be edited from the
   interface that writes it isn't worth keeping, and one presented as a feature
   invites decoration that makes it harder to scan. Newest first, no paging —
   they're capped server-side, so the whole list is the recent past.

   Actions are labelled from the server's own closed list of action keys, so a
   row can never appear here as an unexplained code. */

function When({ at }) {
  const C = useC();
  const { lang } = useLang();
  let text = "—";
  try {
    text = new Date(at).toLocaleString(lang === "ar" ? "ar-AE" : undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { /* leave the dash */ }
  return <span className="data text-[11px] shrink-0" style={{ color: C.slate }} dir="ltr">{text}</span>;
}

export function SyncLog({ syncs = [] }) {
  const C = useC();
  const { t } = useLang();

  if (!syncs.length) {
    return <p className="text-xs" style={{ color: C.slate }}>{t.activity.noSyncs}</p>;
  }

  return (
    <div className="space-y-1.5">
      {syncs.map((s, i) => (
        <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg" style={{ background: "var(--chip-bg)" }}>
          {s.ok
            ? <RefreshCw size={13} className="mt-0.5 shrink-0" style={{ color: C.iris }} />
            : <XCircle size={13} className="mt-0.5 shrink-0" style={{ color: C.rose }} />}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium" style={{ color: s.ok ? C.ink : C.rose }}>
              {s.ok
                ? fill(t.activity.syncOk, { receipts: s.receipts ?? 0, branches: s.branches ?? 0 })
                : fill(t.activity.syncFailed, { error: s.error || "—" })}
            </p>
            {s.ok && s.limitedHistory && (
              <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>{t.activity.syncLimited}</p>
            )}
          </div>
          <When at={s.at} />
        </div>
      ))}
    </div>
  );
}

export function AuditLog({ entries = [], actions = {} }) {
  const C = useC();
  const { t } = useLang();

  if (!entries.length) {
    return <p className="text-xs" style={{ color: C.slate }}>{t.activity.noAudit}</p>;
  }

  return (
    <div className="space-y-1.5">
      {entries.map((e, i) => {
        const label = actions[e.action] || e.action;
        /* A role change is the one entry where the previous value matters as
           much as the new one — it's how an owner spots a widened scope. */
        const changed = e.detail?.fromRole && e.detail.fromRole !== e.detail.role;
        return (
          <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg" style={{ background: "var(--chip-bg)" }}>
            <ShieldAlert size={13} className="mt-0.5 shrink-0" style={{ color: C.slate }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs">
                <span className="font-semibold">{e.actor}</span>
                {" — "}
                {label}
                {e.target && e.target !== e.actor && <span className="font-medium">{` (${e.target})`}</span>}
              </p>
              {changed && (
                <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                  {fill(t.activity.roleFromTo, { from: e.detail.fromRole, to: e.detail.role })}
                </p>
              )}
              {Array.isArray(e.detail?.branches) && e.detail.branches.length > 0 && (
                <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                  {fill(t.activity.branchCount, { n: e.detail.branches.length })}
                </p>
              )}
            </div>
            <When at={e.at} />
          </div>
        );
      })}
    </div>
  );
}

export default function TeamActivity({ syncs, audit, actions }) {
  const { t } = useLang();
  const C = useC();
  return (
    <>
      <div className="panel p-5 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <RefreshCw size={15} style={{ color: C.slate }} />
          <h3 className="display font-bold text-base">{t.activity.syncTitle}</h3>
        </div>
        <p className="text-xs mb-4" style={{ color: C.slate }}>{t.activity.syncNote}</p>
        <SyncLog syncs={syncs} />
      </div>

      <div className="panel p-5 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={15} style={{ color: C.slate }} />
          <h3 className="display font-bold text-base">{t.activity.auditTitle}</h3>
        </div>
        <p className="text-xs mb-4" style={{ color: C.slate }}>{t.activity.auditNote}</p>
        <AuditLog entries={audit} actions={actions} />
      </div>
    </>
  );
}
