/* Sales and delivery channels.

   The counter, a delivery app and the restaurant's own drivers each leave a
   different amount behind for the same dish. This screen says how much, and
   what price on each channel would leave what the counter does.

   Four views of one set of figures: the comparison, the calculator, the
   channels and their fees, and what each channel actually brought in. The
   alerts above them are the same computation the server runs, so an alert
   and the table beneath it cannot disagree. */

import { useCallback, useEffect, useState } from "react";
import { Bike, AlertTriangle, Loader2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import Compare from "../channels/Compare.jsx";
import Calculator from "../channels/Calculator.jsx";
import ChannelList from "../channels/ChannelList.jsx";
import ChannelReport from "../channels/ChannelReport.jsx";
import { fmt } from "../channels/shared.jsx";

const VIEWS = ["compare", "calculator", "channels", "report"];
const SHOWN_ALERTS = 4;

export default function Channels({ token }) {
  const C = useC();
  const { t } = useLang();
  const T = t.ch;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("compare");
  const [branch, setBranch] = useState("");
  const [days, setDays] = useState(30);
  const [focus, setFocus] = useState(null);
  const [allAlerts, setAllAlerts] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ days: String(days), ...(branch ? { branch } : {}) }).toString();
      const res = await fetch(`/api/channels?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setError("");
    } catch {
      setError(T.failed);
    }
  }, [token, days, branch, T.failed]);
  useEffect(() => { load(); }, [load]);

  const api = useCallback(async (method, what, body) => {
    const res = await fetch(`/api/channels?what=${what}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || "generic"), { code: json.error });
    return json;
  }, [token]);

  const go = (next, at) => { setFocus(at ? { ...at, n: Date.now() } : null); setView(next); };

  const alertText = (a) => {
    const A = T.alerts;
    const v = a.values || {};
    const base = { item: a.item, channel: a.channel };
    if (a.kind === "belowInStore") return [fill(A.belowInStore, { ...base, inStore: fmt(v.inStore), here: fmt(v.here) }), v.recommended ? fill(A.belowInStoreFix, { price: fmt(v.recommended) }) : ""];
    if (a.kind === "belowMinimum") return [fill(v.profit <= 0 ? A.belowMinimumLoss : A.belowMinimum, { ...base, price: fmt(v.price), margin: v.marginPct }), v.minimum ? fill(A.belowMinimumFix, { price: fmt(v.minimum) }) : ""];
    if (a.kind === "discountMargin") return [fill(A.discountMargin, { ...base, margin: v.marginPct }), ""];
    if (a.kind === "feesChanged") return [fill(A.feesChanged, { channel: a.channel, date: v.since }), ""];
    if (a.kind === "feesStale") return [fill(A.feesStale, { channel: a.channel, days: v.days }), ""];
    return [fill(A.noFees, { channel: a.channel }), ""];
  };
  const alertAction = (a) => {
    if (a.itemKey) return [T.alerts.open, () => go("calculator", { itemKey: a.itemKey, channelId: a.channelId })];
    if (a.kind === "feesChanged") return [T.alerts.review, () => go("compare", { channelId: a.channelId })];
    return [T.alerts.setFees, () => go("channels", { channelId: a.channelId })];
  };

  const alerts = data?.alerts || [];
  const shownAlerts = allAlerts ? alerts : alerts.slice(0, SHOWN_ALERTS);
  const tone = (a) => (a.severity === "critical" ? C.rose : a.severity === "warning" ? C.amber : C.slate);
  const props = { data, T, C, api, onChanged: load, focus };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="display font-bold text-xl">{T.title}</h2>
            <p className="text-xs mt-0.5 leading-relaxed" style={{ color: C.slate }}>{T.lead}</p>
          </div>
          <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: C.irisWash, color: C.iris }}><Bike size={19} /></div>
        </div>

        {error && !data && (
          <div className="panel p-5 text-center">
            <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>
            <button onClick={load} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: C.iris, color: "#fff" }}>{T.retry}</button>
          </div>
        )}
        {!data && !error && <div className="flex justify-center py-12" style={{ color: C.slate }}><Loader2 className="animate-spin" /></div>}

        {data && (
          <>
            {data.branches.length > 1 && (
              <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={T.branch}
                className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl text-sm outline-none" style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` }}>
                <option value="">{T.allBranches}</option>
                {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}

            {alerts.length > 0 && (
              <div className="panel p-4">
                <h3 className="display font-bold text-sm mb-2 flex items-center gap-2"><AlertTriangle size={15} style={{ color: C.amber }} />{T.alerts.title}</h3>
                {shownAlerts.map((a, i) => {
                  const [main, fix] = alertText(a);
                  const [label, run] = alertAction(a);
                  return (
                    <div key={`${a.kind}:${a.channelId}:${a.itemKey || ""}:${i}`} className="py-2.5 flex items-start gap-3" style={{ borderTop: i ? `1px solid ${C.hairline}` : "none" }}>
                      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: tone(a) }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs leading-relaxed">{main} {fix && <span style={{ color: C.slate }}>{fix}</span>}</p>
                        <button onClick={run} className="text-[11px] font-bold mt-1" style={{ color: C.iris }}>{label}</button>
                      </div>
                    </div>
                  );
                })}
                {alerts.length > SHOWN_ALERTS && (
                  <button onClick={() => setAllAlerts((v) => !v)} className="text-[11px] font-bold mt-1" style={{ color: C.slate }}>
                    {allAlerts ? t.pos.common.close : fill(T.alerts.more, { n: alerts.length - SHOWN_ALERTS })}
                  </button>
                )}
              </div>
            )}

            <div className="flex p-1 rounded-2xl gap-1 overflow-x-auto no-scrollbar" style={{ background: "var(--chip-bg)" }} role="tablist">
              {VIEWS.map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => go(v)}
                  className="flex-1 shrink-0 px-3 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap"
                  style={{ background: view === v ? C.surface : "transparent", color: view === v ? C.ink : C.slate }}>{T.views[v]}</button>
              ))}
            </div>

            {/* Keyed on what was asked for, so arriving from an alert opens
                the view on that item and channel rather than where it was. */}
            <div key={`${view}:${focus?.n || 0}`} className="pane-in">
              {view === "compare" && <Compare {...props} />}
              {view === "calculator" && <Calculator {...props} />}
              {view === "channels" && <ChannelList {...props} />}
              {view === "report" && <ChannelReport {...props} days={days} onDays={setDays} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
