/* A strip under the header when the connected Loyverse could not be read.

   Its sales are then missing from every figure, or are as last read, and a
   dashboard that looks complete while missing a till is worse than an error:
   somebody reads the dip as a slow week. Said once, with Loyverse's reason. */

import { AlertTriangle } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang, fill } from "./i18n.jsx";

export default function TillBanner({ pos, onOpen }) {
  const C = useC();
  const { t } = useLang();
  const L = t.pos.loyverse;
  if (!pos) return null;
  const text = pos.lost
    ? L.lost
    : pos.connected && pos.ok === false
      ? fill(L.unavailable, { reason: L.reasons[pos.error] || L.reasons.upstream })
      : "";
  if (!text) return null;
  return (
    <button type="button" role="status" onClick={onOpen}
      className="shrink-0 w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[11.5px] font-semibold text-center"
      style={{ background: "rgba(251,113,133,0.10)", color: C.rose, borderBottom: `1px solid ${C.hairline}` }}>
      <AlertTriangle size={13} className="shrink-0" />
      <span>{text}</span>
    </button>
  );
}
