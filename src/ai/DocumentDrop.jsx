import { useState, useRef } from "react";
import { FileUp, Loader2, ArrowRight, HelpCircle, Lock } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { prepareFile, scanErrorMessage, AttachError } from "./attach.js";

/* Dropping a document into Ask.

   Somebody holding a PDF does not think about which tab it belongs to. They
   have a supplier invoice, a stock take a manager typed up, a recipe the head
   chef wrote — and they want the app to take it. Making them first work out
   whether that is an inventory document or a cost document is asking them to
   learn the filing system before the software will accept their paperwork.

   So it is read once, sorted server-side, and offered.

   Offered, not obeyed. Even a confident classification is a suggestion with a
   button under it, because being carried to the wrong screen is worse than
   being asked which one — and the pair most easily confused, a supplier
   invoice against a customer bill, are both lists of priced lines. A
   low-confidence answer is presented as a question rather than a destination.

   Nothing is written here. The route ends at a scanner that already exists and
   already asks for confirmation, so the document becomes a filled-in form and
   never a committed record. */

export default function DocumentDrop({ token, onRoute }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.docdrop;

  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState("");
  const input = useRef(null);

  /* The same preparation the scanners use, for the same reason: this sent the
     chosen file untouched, so a photograph rode the request at full 12MP and a
     PDF over about 3 MB was bounced by the platform before the route saw it.
     Both came back as "the photo couldn't be read", and one of the two error
     codes this checked for — "image" — had stopped being returned at all. */
  async function classify(file) {
    setBusy(true);
    setError("");
    setVerdict(null);
    let isPdf = false;
    try {
      const prepared = await prepareFile(file);
      isPdf = prepared.isPdf;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: "auto", images: prepared.dataUrls, lang }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(scanErrorMessage(t.aiscan, { status: res.status, ...json, isPdf }));
        return;
      }
      setVerdict({ ...json.result, name: file.name });
    } catch (err) {
      setError(err instanceof AttachError
        ? scanErrorMessage(t.aiscan, { ...err, isPdf })
        : (isPdf ? t.aiscan.pdfFailed : t.aiscan.failed));
    } finally {
      setBusy(false);
    }
  }

  const label = (kind) => s.kinds[kind] || s.kinds.unknown;

  return (
    <div className="rounded-xl p-4" style={{ border: `1px dashed ${C.hairline}` }}>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) classify(f); e.target.value = ""; }}
      />

      {!verdict && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: C.irisWash, color: C.iris }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            {busy ? s.reading : s.upload}
          </button>
          <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.lead}</p>
        </>
      )}

      {verdict && (
        <div>
          <p className="text-[11px] mb-1 truncate" style={{ color: C.slate }}>{verdict.name}</p>

          {verdict.kind === "unknown" && (
            <>
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <HelpCircle size={14} style={{ color: C.slate }} /> {s.unplaced}
              </p>
              <p className="text-xs mt-1" style={{ color: C.slate }}>{s.unplacedNote}</p>
            </>
          )}

          {verdict.kind !== "unknown" && (
            <>
              <p className="text-sm font-semibold">
                {/* Certain reads as a statement, uncertain as a question, so
                    the wording itself carries how much to trust it. */}
                {fill(verdict.certain ? s.looksLike : s.mightBe, { kind: label(verdict.kind) })}
              </p>
              {/* What was actually pulled out, so the offer is a description of
                  work already done rather than a promise about what will
                  happen after the button is pressed. */}
              {verdict.extracted && (
                <p className="text-xs mt-1" style={{ color: C.cyan }}>
                  {fill(s.readOut, { n: (verdict.extracted.lines || verdict.extracted.items || []).length })}
                </p>
              )}
              {verdict.why && (
                <p className="text-xs mt-1" style={{ color: C.slate }}>{verdict.why}</p>
              )}

              {verdict.route?.allowed ? (
                <button
                  type="button"
                  onClick={() => onRoute?.(verdict.route, verdict.extracted)}
                  className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold"
                  style={{ background: C.iris, color: C.onPrimary }}
                >
                  <ArrowRight size={14} className="flip-rtl" />
                  {fill(s.takeMeThere, { tab: t[verdict.route.tab]?.tab || verdict.route.tab })}
                </button>
              ) : (
                <p className="text-xs mt-3 flex items-start gap-1.5" style={{ color: C.slate }}>
                  <Lock size={12} className="mt-0.5 shrink-0" />
                  {fill(s.notYours, { tab: t[verdict.route?.tab]?.tab || "" })}
                </p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => { setVerdict(null); input.current?.click(); }}
            className="mt-3 ms-3 text-xs font-semibold"
            style={{ color: C.slate }}
          >
            {s.another}
          </button>
        </div>
      )}

      {error && <p className="text-xs mt-2" style={{ color: C.rose }}>{error}</p>}
    </div>
  );
}
