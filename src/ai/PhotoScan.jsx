import { useRef, useState, useEffect } from "react";
import { Camera, Loader2, RotateCcw, FileText } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { prepareFile, looksLikePdf, scanErrorMessage, AttachError } from "./attach.js";

/* Take or choose a photo or a document, send it to the AI, hand the parsed
   result up.

   One component for every document-analysis job in the app: the bill scanner
   and the inventory reader differ only in `kind` and in how the parent renders
   the result.

   Everything about turning the chosen file into something the server is
   allowed to receive lives in attach.js, including why the size limit is what
   it is. The short version: a Vercel function may be handed 4.5 MB, and a
   scanned invoice is usually larger than that, so a big PDF is rendered to
   page images here rather than refused. */

export default function PhotoScan({ token, kind, onResult, buttonLabel }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.aiscan;
  const inputRef = useRef(null);
  const [preview, setPreview] = useState("");
  const [fileName, setFileName] = useState("");
  /* Follows the sniff rather than the data URL: a PDF handed over with an
     empty type becomes application/octet-stream, and keying the preview off
     that rendered a broken image icon over a file that was perfectly fine. */
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [busy, setBusy] = useState(false);
  /* What it is busy doing. Rendering a twenty-page scan takes several seconds
     on a phone, and a spinner that says "reading the photo" through all of it
     looks like a hang on a document nobody photographed. */
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  /* Set when a document was too long to send whole, so the pages that were
     dropped are stated rather than quietly missing from the result. */
  const [clipped, setClipped] = useState(null);
  /* Read on open, which costs nothing: GET reports the allowance without
     spending one. Somebody sees "12 left" before taking the photo rather than
     after being refused. */
  const [scans, setScans] = useState(null);

  useEffect(() => {
    fetch("/api/ai", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.scans && setScans(j.scans))
      .catch(() => {});
  }, [token]);

  async function analyze(file) {
    setBusy(true);
    setError("");
    setClipped(null);
    setStage(s.analyzing);
    /* Held so a failure can be described in the right terms. A photograph that
       cannot be read may genuinely need better light; a document never does,
       and saying so is the difference between a hint and a dead end. */
    let isPdf = false;
    try {
      isPdf = await looksLikePdf(file);
      setPreviewIsPdf(isPdf);
      setFileName(file?.name || "");

      const prepared = await prepareFile(file, {
        onProgress: (page, total) => setStage(fill(s.renderingPage, { n: page, total })),
      });
      isPdf = prepared.isPdf;
      setPreviewIsPdf(prepared.isPdf);
      setPreview(prepared.dataUrls[0]);
      if (prepared.rasterised && prepared.sent < prepared.pageCount) {
        setClipped({ sent: prepared.sent, total: prepared.pageCount });
      }

      setStage(s.analyzing);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, images: prepared.dataUrls, lang }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        /* Every refusal used to read "the photo couldn't be read, try again in
           better light" — a spent allowance, a file the platform bounced, an
           unreadable type, and a PDF, all the same sentence. Each says what it
           actually is now, and the mapping is shared with the other scanner so
           they cannot drift apart again. */
        setError(scanErrorMessage(s, { status: res.status, ...json, isPdf }));
        if (json.error === "quota") setScans({ left: 0 });
        return;
      }
      if (json.scans) setScans(json.scans);
      /* The depletion plan rides alongside the result rather than inside it:
         it is a proposal about stock, not part of what the photo said. */
      onResult(json.result, prepared.dataUrls[0], json.depletion || null);
    } catch (err) {
      setError(err instanceof AttachError
        ? scanErrorMessage(s, { ...err, isPdf })
        : (isPdf ? s.pdfFailed : s.failed));
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  const spinner = stage || s.analyzing;

  return (
    <div>
      {/* No `capture` attribute, deliberately.

          It used to say `capture="environment"`, which on a phone does not
          mean "offer the camera" — it means "the camera is the only source".
          iOS and Android both drop the Photo Library and Files entries from
          the sheet when it is present, so on mobile there was no way to send
          the PDF a supplier had emailed or a recipe card already saved to the
          camera roll. The button offered an upload the operating system then
          refused to allow.

          Without it the sheet lists Take Photo alongside Photo Library and
          Browse, so the camera is still one tap away and everything else is
          reachable. On a desktop it was never anything but a file dialog. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) analyze(file);
        }}
      />

      {preview && (
        <div className="mb-3 relative rounded-xl overflow-hidden" style={{ border: `1px solid ${C.hairline}` }}>
          {/* A PDF sent whole has nothing to show in an <img>, and a broken
              image icon reads as the upload having failed. Name the file
              instead. A PDF that was rendered to pages does have something to
              show — its first page — so it shows it. */}
          {previewIsPdf && !preview.startsWith("data:image")
            ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm"
                style={{ opacity: busy ? 0.5 : 1, color: C.slate }}>
                <FileText size={18} style={{ color: C.iris }} />
                <span className="truncate">{fileName || s.pdfReady}</span>
              </div>
            )
            /* Anchored to the top, not the centre. A photograph is framed on
               its subject and crops happily from the middle, but a rendered
               page is a page: the supplier's name, the invoice number and the
               date are all in the top inch, and a centred crop showed the
               middle of the line items instead — the one part of the document
               that identifies nothing. */
            : <img src={preview} alt="" className="w-full max-h-56 object-cover object-top" style={{ opacity: busy ? 0.5 : 1 }} />}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold text-center px-3"
              style={{ background: "rgba(0,0,0,0.35)", color: "#fff" }}>
              <Loader2 size={16} className="animate-spin shrink-0" /> {spinner}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
        style={{ background: C.iris, color: C.onPrimary }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : preview ? <RotateCcw size={16} /> : <Camera size={16} />}
        {busy ? spinner : preview ? s.retake : buttonLabel || s.take}
      </button>

      {/* Pages that did not fit are named. A document read from page one to
          page eleven of fourteen looks complete on screen, and the three
          missing pages of invoice lines are found in a stock count weeks
          later, if at all. */}
      {clipped && !error && (
        <p className="text-[11px] mt-2" style={{ color: C.amber }}>
          {fill(s.pagesClipped, { n: clipped.sent, total: clipped.total })}
        </p>
      )}

      {scans && scans.left !== undefined && !error && (
        <p className="text-[11px] mt-2" style={{ opacity: 0.7 }}>
          {fill(s.quotaLeft, { n: scans.left })}
        </p>
      )}
      {error && <p className="text-xs mt-2" style={{ color: C.rose }}>{error}</p>}
    </div>
  );
}
