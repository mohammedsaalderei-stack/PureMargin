/* Sending a receipt to a customer's inbox.

   The address is typed here, or filled in from the customer on the sale. The
   message itself is written by the server in the language this register is
   in; nothing but the address goes from here into it. */

import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Sheet, Btn, Field } from "./ui.jsx";
import { call, RegisterError } from "./api.js";

export default function EmailReceipt({ token, number, initial = "", onClose }) {
  const C = useC();
  const { t, lang } = useLang();
  const E = t.pos.email;
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const send = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await call(token, "email", { method: "POST", body: { number, email: email.trim(), lang } });
      setSent(email.trim());
    } catch (err) {
      const code = err instanceof RegisterError ? err.body?.error : "network";
      setError(E.errors[code] || E.errors.send);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={E.title} onClose={busy ? () => {} : onClose}
      footer={sent
        ? <Btn full size="lg" onClick={onClose}>{t.pos.common.done}</Btn>
        : <Btn full size="lg" disabled={busy || !email.trim()} onClick={send}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Mail size={17} />}{E.send}</Btn>}>
      {sent ? (
        <p className="text-sm font-semibold py-4 text-center" style={{ color: C.mint }}>{fill(E.sent, { email: sent })}</p>
      ) : (
        <>
          <Field label={E.address} value={email} onChange={setEmail} type="email" inputMode="email" dir="ltr" autoFocus />
          <p className="text-xs data" dir="ltr" style={{ color: C.slate }}>{number}</p>
          {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}
        </>
      )}
    </Sheet>
  );
}
