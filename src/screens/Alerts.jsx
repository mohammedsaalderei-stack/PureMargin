import { useEffect, useState } from "react";
import { BellRing, AlertTriangle } from "lucide-react";
import AlertCard from "../alerts/AlertCard.jsx";
import TargetsForm from "../alerts/TargetsForm.jsx";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { scopeQuery, scopeKey } from "../scopeParam.js";

/* The operational list — stage 4, phase 7.

   Every phase before this one produced figures. This screen is where they turn
   into work: ranked by severity and then by money, each with the threshold it
   crossed and one recommended action.

   An empty list is deliberately not celebrated when the data is thin. "Nothing
   above your thresholds" and "nothing recorded to compare" look identical on a
   screen and mean opposite things, so recipe coverage decides which sentence
   appears. */

export default function Alerts({ token, branches = [] }) {
  const C = useC();
  const { t } = useLang();
  const s = t.alerts;

  const [data, setData] = useState(null);

  async function load() {
    const res = await fetch(`/api/alerts?_=1${scopeQuery(branches)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setData(await res.json());
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey(branches)]);

  async function saveTargets(targets) {
    const res = await fetch("/api/alerts", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    if (res.ok) await load();
  }

  if (!data) return null;

  const thin = (data.quality?.recipeCoverage || 0) === 0;

  return (
    <div className="h-full overflow-y-auto">
      {/* The shell's <main> is overflow-hidden, so every screen owns its own
          scroll container. Five did not, which was survivable while their
          content happened to fit and stopped being survivable the moment a
          scanner added a result panel below the fold — the page simply ended
          and there was no way to reach the save button. */}
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
        <div>
          <h2 className="display font-bold text-xl">{s.title}</h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
        </div>

        {data.sales?.error && (
          <div className="panel p-4 flex gap-2.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: C.rose }} />
            <p className="text-xs" style={{ color: C.slate }}>
              {data.sales.error === "notconnected" ? s.salesNotConnected : s.salesMissing}
            </p>
          </div>
        )}

        <div className="panel p-5 md:p-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {["critical", "warning", "info"].map((level) => (
              <span key={level} className="text-[11px] px-2.5 py-1 rounded-lg font-semibold"
                style={{ background: "var(--chip-bg)", color: C.slate }}>
                {s.severity[level]}: {data.counts[level]}
              </span>
            ))}
          </div>

          {data.alerts.length === 0 ? (
            <div className="text-center py-8">
              <BellRing size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
              <p className="text-sm" style={{ color: C.slate }}>{thin ? s.emptyThin : s.empty}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}
            </div>
          )}
        </div>

        <TargetsForm targets={data.targets} canEdit={data.canEditTargets} onSave={saveTargets} />
      </div>
    </div>
  );
}
