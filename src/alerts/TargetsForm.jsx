import { useState } from "react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* The thresholds behind every alert on the screen above.

   They are shown next to the alerts rather than buried in settings, because an
   operator's first honest reaction to a warning is often "that's normal for us" —
   and the right answer to that is to move the threshold, not to ignore the list.
   Read-only for anyone without `manage:costs`: a threshold change alters what the
   whole organization is told to worry about. */

const FIELDS = ["foodCostPct", "variancePct", "varianceFloor", "coverDays", "slowMovingDays", "expiryDays"];

export default function TargetsForm({ targets, canEdit, onSave }) {
  const C = useC();
  const { t } = useLang();
  const s = t.alerts;
  const [draft, setDraft] = useState(targets);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = FIELDS.some((f) => Number(draft[f]) !== Number(targets[f]));

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel p-5 md:p-6">
      <h3 className="display font-bold text-base">{s.targetsTitle}</h3>
      <p className="text-xs mt-1" style={{ color: C.slate }}>
        {canEdit ? s.targetsLead : s.targetsLocked}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
        {FIELDS.map((field) => (
          <label key={field} className="block">
            <span className="text-[11px] font-semibold" style={{ color: C.slate }}>{s.fields[field]}</span>
            <input
              type="number" min="0" inputMode="decimal" disabled={!canEdit}
              value={draft[field] ?? ""}
              onChange={(e) => { setSaved(false); setDraft({ ...draft, [field]: e.target.value }); }}
              className="w-full mt-1 px-3 py-2 rounded-lg text-sm tabular-nums"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink, opacity: canEdit ? 1 : 0.6 }}
            />
          </label>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center gap-3 mt-4">
          <button onClick={save} disabled={!dirty || saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: C.iris, color: C.onPrimary, opacity: !dirty || saving ? 0.5 : 1 }}>
            {s.save}
          </button>
          {saved && <span className="text-xs" style={{ color: C.slate }}>{s.saved}</span>}
        </div>
      )}
    </div>
  );
}
