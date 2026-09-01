import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import useBackToClose from "../useBackToClose.js";

/* One dialog, two shapes.

   A constant cost is an amount and how often it recurs. A variable cost is an
   amount and the day it happened. Everything else about entering them — the
   title field, the numeric keypad, validation, the save button, what Escape
   and the back gesture do — is identical, and writing it twice is how the two
   halves of one screen drift into behaving differently.

   The difference is one prop. `kind="fixed"` shows the frequency selector;
   `kind="variable"` shows the date picker. Neither ever shows both. */

const FREQUENCIES = ["monthly", "yearly"];

function todayISO() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function CostModal({ open, kind, initial, onClose, onSave, busy, error }) {
  const C = useC();
  const { t } = useLang();
  const s = t.costs;
  const fixed = kind === "fixed";

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [date, setDate] = useState(todayISO());
  const [touched, setTouched] = useState(false);
  const firstRef = useRef(null);

  const close = useRef(onClose);
  close.current = onClose;
  useBackToClose(open, () => close.current());

  /* Reset from `initial` every time the dialog opens, not on mount. Held state
     from a previous open is how "edit rent" comes up pre-filled with the
     salaries row somebody looked at a minute ago. */
  useEffect(() => {
    if (!open) return undefined;
    setTitle(initial?.title || "");
    setAmount(initial?.amount != null ? String(initial.amount) : "");
    setFrequency(FREQUENCIES.includes(initial?.frequency) ? initial.frequency : "monthly");
    setDate(initial?.date || todayISO());
    setTouched(false);

    const onKey = (e) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    const focus = setTimeout(() => firstRef.current?.focus(), 40);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(focus); };
  }, [open, initial]);

  if (!open) return null;

  const badTitle = !title.trim();
  const badAmount = !(Number(amount) > 0);
  const invalid = badTitle || badAmount;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    onSave(fixed
      ? { title: title.trim(), amount: Number(amount), frequency }
      : { title: title.trim(), amount: Number(amount), date });
  };

  const field = {
    className: "w-full rounded-xl px-3 py-2.5 text-sm outline-none",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  const label = (text) => (
    <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{text}</div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="palette-in w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={initial?.id ? s.editTitle : (fixed ? s.addFixed : s.addVariable)}
      >
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <h3 className="display font-bold text-base">
            {initial?.id ? s.editTitle : (fixed ? s.addFixed : s.addVariable)}
          </h3>
          <button type="button" onClick={onClose} aria-label={s.cancel}
            className="p-1 rounded-lg" style={{ color: C.slate }}>
            <X size={17} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            {label(s.fieldTitle)}
            <input
              {...field}
              ref={firstRef}
              value={title}
              placeholder={fixed ? s.titlePlaceholderFixed : s.titlePlaceholderVariable}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{
                ...field.style,
                border: `1px solid ${touched && badTitle ? C.rose : C.hairline}`,
              }}
            />
          </div>

          <div>
            {label(s.fieldAmount)}
            <input
              {...field}
              type="number" min="0" step="0.01" inputMode="decimal" dir="ltr"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{
                ...field.style,
                border: `1px solid ${touched && badAmount ? C.rose : C.hairline}`,
              }}
            />
          </div>

          {/* Frequency, for a constant cost. A segmented control rather than a
              dropdown: there are two choices and both should be readable
              without opening anything. */}
          {fixed && (
            <div>
              {label(s.fieldFrequency)}
              <div className="flex rounded-xl p-1 gap-1"
                style={{ background: C.bone, border: `1px solid ${C.hairline}` }}>
                {FREQUENCIES.map((f) => {
                  const on = frequency === f;
                  return (
                    <button
                      key={f} type="button" onClick={() => setFrequency(f)}
                      aria-pressed={on}
                      className="flex-1 rounded-lg py-2 text-xs font-semibold transition-colors"
                      style={on
                        ? { background: C.iris, color: C.onPrimary }
                        : { background: "transparent", color: C.slate }}
                    >
                      {s.frequencies[f]}
                    </button>
                  );
                })}
              </div>
              {/* Stated at the moment of choosing, not afterwards. A yearly
                  licence is listed and totalled as a twelfth of itself, and
                  somebody who enters 8,400 and sees 700 in the list has to be
                  told why before they conclude the app lost their money. */}
              {frequency === "yearly" && Number(amount) > 0 && (
                <p className="text-[11px] mt-2" style={{ color: C.slate }}>
                  {s.yearlyNote.replace("{amount}", (Number(amount) / 12).toFixed(2))}
                </p>
              )}
            </div>
          )}

          {/* Date, for a variable cost. */}
          {!fixed && (
            <div>
              {label(s.fieldDate)}
              <input
                {...field}
                type="date" dir="ltr"
                value={date}
                onChange={(e) => setDate(e.target.value || todayISO())}
              />
            </div>
          )}

          {touched && invalid && (
            <p className="text-xs" style={{ color: C.rose }}>{s.errFields}</p>
          )}
          {error && <p className="text-xs" style={{ color: C.rose }}>{error}</p>}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ background: "transparent", border: `1px solid ${C.hairline}`, color: C.ink }}>
            {s.cancel}
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: C.iris, color: C.onPrimary }}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {s.save}
          </button>
        </div>
      </div>
    </div>
  );
}
