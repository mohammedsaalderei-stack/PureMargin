/* A device handed to staff, and the way back from it.

   Locking swaps this device's session for one the server will only let
   reach the register (`issueDeviceToken` in `api/_auth.js`), so clearing the
   app's storage or typing an address does not open the back office: the
   token itself cannot. Leaving is signing in again with the business
   account's password, which a cashier does not have. */

import { useState } from "react";
import { Lock, KeyRound, Loader2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { Sheet, Btn, Field } from "./ui.jsx";
import { call } from "./api.js";

export function LockDeviceSheet({ token, pinsRequired, onClose, onLocked }) {
  const C = useC();
  const { t } = useLang();
  const D = t.pos.device;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lock = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await call(token, "device", { method: "POST" });
      onLocked(out.token);
    } catch {
      setError(t.pos.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Sheet title={D.lockTitle} onClose={busy ? () => {} : onClose}
      footer={<Btn full size="lg" disabled={busy} onClick={lock}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Lock size={17} />}{D.lockConfirm}</Btn>}>
      <p className="text-sm leading-relaxed mb-3" style={{ color: C.ink }}>{D.lockLead}</p>
      {!pinsRequired && (
        <p className="text-xs leading-relaxed rounded-2xl p-3" style={{ background: "rgba(251,191,36,0.12)", color: C.amber }}>{D.lockPins}</p>
      )}
      {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}
    </Sheet>
  );
}

export function UnlockSheet({ onClose, onUnlocked }) {
  const C = useC();
  const { t } = useLang();
  const D = t.pos.device;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unlock = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError("");
    try {
      const name = username.trim();
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, email: name.includes("@") ? name : "", password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? D.tooMany : res.status === 401 ? D.wrong : D.failed);
        return;
      }
      onUnlocked(data.token, data.account?.username || name);
    } catch {
      setError(D.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={D.unlockTitle} onClose={busy ? () => {} : onClose}
      footer={<Btn full size="lg" disabled={busy || !username.trim() || !password} onClick={unlock}>
        {busy ? <Loader2 size={17} className="animate-spin" /> : <KeyRound size={17} />}{D.unlock}
      </Btn>}>
      <p className="text-sm mb-4" style={{ color: C.slate }}>{D.unlockLead}</p>
      <Field label={D.username} value={username} onChange={setUsername} dir="ltr" autoFocus />
      <label className="block mb-3">
        <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{D.password}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr"
          onKeyDown={(e) => e.key === "Enter" && unlock()} autoComplete="current-password"
          className="w-full px-3.5 py-3 rounded-xl text-base outline-none"
          style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` }} />
      </label>
      {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}
    </Sheet>
  );
}
