/* Who is at the register: a PIN, four to six digits. */

import { useState } from "react";
import { Lock, ArrowLeftRight } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import BrandMark from "../BrandMark.jsx";
import { Keypad, keyInto } from "./ui.jsx";
import { call, RegisterError, rememberPin, offlinePin } from "./api.js";

export default function PinPad({ token, onSignedIn, onExit, exitLabel, business }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (value) => {
    setBusy(true);
    setError("");
    try {
      const out = await call(token, "pin", { method: "POST", body: { pin: value } });
      rememberPin(value, out.operator, out.token);
      onSignedIn(out.operator, out.token);
    } catch (err) {
      /* No connection: somebody who has signed in on this device before is
         let in from what it remembered; anybody else is told why not. */
      if (!(err instanceof RegisterError)) {
        const known = await offlinePin(value);
        if (known) { onSignedIn(known.operator, known.token); return; }
        setPin("");
        setError(P.offline.pin);
        return;
      }
      setPin("");
      setError(err.status === 429 ? P.pin.locked : P.pin.wrong);
    } finally {
      setBusy(false);
    }
  };

  const key = (k) => {
    if (busy) return;
    const next = keyInto(pin, k, { decimal: false, max: 6 });
    setPin(next);
    setError("");
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-xs text-center">
        <BrandMark size={40} />
        <h2 className="display font-bold text-xl mt-4">{business || P.nav.register}</h2>
        <p className="text-sm mt-1 mb-6 flex items-center justify-center gap-1.5" style={{ color: C.slate }}><Lock size={13} />{P.pin.lead}</p>
        <div className="flex justify-center gap-3 mb-6" dir="ltr">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: i < pin.length ? C.iris : "var(--chip-bg)", border: `1px solid ${C.hairline}`, opacity: i < 4 || pin.length > i ? 1 : 0.35 }} />
          ))}
        </div>
        <Keypad decimal={false} onKey={key} />
        <button onClick={() => submit(pin)} disabled={pin.length < 4 || busy}
          className="w-full mt-3 py-4 rounded-2xl font-bold disabled:opacity-40" style={{ background: C.iris, color: "#fff" }}>
          {P.pin.enter}
        </button>
        {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}
        <button onClick={onExit} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.slate }}>
          <ArrowLeftRight size={14} />{exitLabel || P.nav.backOffice}
        </button>
      </div>
    </div>
  );
}
