import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang, fill } from "./i18n.jsx";

/* The gate in front of deleting an account.

   Two deliberate pieces of friction. The word has to be typed out, so the action
   can't be reached by a mis-aimed click or a stray Enter on a focused button —
   and the confirm button stays disabled until it matches, so there is no moment
   where the destructive action is one keystroke away. Red throughout, because
   this is the one place in the app where the colour is a warning rather than
   decoration.

   Typing is compared case-insensitively after trimming: the point is a
   deliberate act, not a spelling test, and caps-lock shouldn't be the thing
   standing between an owner and their own account.

   Used for both deletion paths. The grace-period one is undoable and the
   immediate one is not, which `tone="now"` reflects in the wording — but both
   destroy an organization's data, so both are typed. */

export const CONFIRM_WORD = "DELETE";

export default function DeleteConfirm({ tone = "grace", busy, onConfirm, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const [typed, setTyped] = useState("");

  const matches = typed.trim().toUpperCase() === CONFIRM_WORD;
  const immediate = tone === "now";

  return (
    <>
      <div className="flex items-start gap-2 mb-2">
        {immediate && <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: C.rose }} />}
        <p className="font-semibold text-sm" style={{ color: immediate ? C.rose : undefined }}>
          {immediate ? t.account.deleteNowTitle : t.account.deleteConfirmTitle}
        </p>
      </div>

      <p className="text-sm leading-relaxed mb-4" style={{ color: C.slate }}>
        {immediate ? t.account.deleteNowLead : t.account.deleteConfirmLead}
      </p>

      <label className="block text-sm mb-4">
        <span style={{ color: C.slate }}>
          {fill(t.account.typeToConfirm, { word: CONFIRM_WORD })}
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          /* Never autofilled or autocorrected — the browser must not be able to
             complete this word on the user's behalf. */
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={CONFIRM_WORD}
          dir="ltr"
          className="mt-2 w-full max-w-[220px] px-3 py-2 rounded-lg text-sm font-semibold tracking-widest"
          style={{
            background: C.bone,
            border: `1px solid ${matches ? C.rose : C.hairline}`,
            color: C.ink,
          }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onConfirm}
          disabled={busy || !matches}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: C.rose, color: "#fff" }}
        >
          {immediate ? t.account.deleteNowConfirm : t.account.deleteConfirm}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
        >
          {t.account.deleteCancel}
        </button>
      </div>
    </>
  );
}
