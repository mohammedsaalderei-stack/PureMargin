import { useRef, useState, useEffect } from "react";
import { Camera, Loader2, RotateCcw, FileText, Plus, X, ScanLine } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { prepareFile, looksLikePdf, scanErrorMessage, AttachError, addPages } from "./attach.js";

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
  /* Photographs waiting to be read together as one document.

     A paper invoice is photographed a page at a time. Each photo used to be
     read the moment it was taken, so page two became a second scan of a
     second "invoice", with no supplier, no date and half the lines, and there
     was no way to send both pages at once. Now photos gather here, in order,
     until somebody says read. A lone PDF still goes straight through: it
     already carries its pages. */
  const [pages, setPages] = useState([]);
  /* How many pages did not fit in one reading, so the screen can say so. */
  const [pagesRefused, setPagesRefused] = useState(0);

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
      if (prepared.rasterised && prepared.sent < prepared.pageCount) {
        setClipped({ sent: prepared.sent, total: prepared.pageCount });
      }
      await send(prepared.dataUrls, isPdf);
    } catch (err) {
      setError(err instanceof AttachError
        ? scanErrorMessage(s, { ...err, isPdf })
        : (isPdf ? s.pdfFailed : s.failed));
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  /* One request for one document, however many pages it arrived as. The
     server reads every image in the order sent, as one document, so a line
     that runs across a page break still reads as one line. */
  async function send(dataUrls, isPdf) {
    setPreview(dataUrls[0]);
    setStage(s.analyzing);
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind, images: dataUrls, lang }),
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
      return false;
    }
    if (json.scans) setScans(json.scans);
    /* The depletion plan rides alongside the result rather than inside it:
       it is a proposal about stock, not part of what the photo said. */
    onResult(json.result, dataUrls[0], json.depletion || null);
    return true;
  }

  /* What the picker handed over: one file or several, taken or chosen. */
  async function gather(files) {
    if (!files.length) return;
    if (files.length === 1 && !pages.length && await looksLikePdf(files[0])) {
      return analyze(files[0]);
    }
    setBusy(true);
    setError("");
    setClipped(null);
    setPreview("");
    setStage(s.addingPages);
    let gathered = pages;
    let refused = pagesRefused;
    let isPdf = false;
    try {
      for (const file of files) {
        const prepared = await prepareFile(file, {
          onProgress: (page, total) => setStage(fill(s.renderingPage, { n: page, total })),
        });
        isPdf = prepared.isPdf;
        const added = addPages(gathered, prepared.dataUrls);
        gathered = added.pages;
        refused += added.refused;
      }
    } catch (err) {
      /* The pages gathered before the one that failed are kept. */
      setError(err instanceof AttachError
        ? scanErrorMessage(s, { ...err, isPdf })
        : (isPdf ? s.pdfFailed : s.failed));
    } finally {
      setPages(gathered);
      setPagesRefused(refused);
      setBusy(false);
      setStage("");
    }
  }

  async function readPages() {
    setBusy(true);
    setError("");
    setPreviewIsPdf(false);
    setFileName("");
    try {
      if (await send(pages, false)) {
        setPages([]);
        setPagesRefused(0);
      }
    } catch {
      setError(s.failed);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  function removePage(index) {
    setPages(pages.filter((_, i) => i !== index));
    /* Room was made, so nothing is refused any more; the next Add page is
       measured afresh. */
    setPagesRefused(0);
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
          reachable. On a desktop it was never anything but a file dialog.

          `multiple` lets the library hand over every page of an invoice in
          one go. Take Photo still returns one picture, which is what Add page
          is for. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          gather(files);
        }}
      />

      {pages.length > 0 && (
        <div className="mb-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pages.map((url, i) => (
              <div key={i} className="relative shrink-0 w-16 h-20 rounded-lg overflow-hidden"
                style={{ border: `1px solid ${C.hairline}`, opacity: busy ? 0.5 : 1 }}>
                {url.startsWith("data:image")
                  ? <img src={url} alt="" className="w-full h-full object-cover object-top" />
                  : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText size={18} style={{ color: C.iris }} />
                    </div>
                  )}
                <span className="absolute bottom-0 inset-x-0 text-[10px] text-center py-0.5"
                  style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}>
                  {fill(s.pageN, { n: i + 1 })}
                </span>
                {!busy && (
                  <button type="button" onClick={() => removePage(i)}
                    aria-label={fill(s.removePage, { n: i + 1 })}
                    className="absolute top-0.5 end-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {/* Said, not skipped: a page left behind is invoice lines missing
              from stock, found weeks later in a count if at all. */}
          {pagesRefused > 0 && (
            <p className="text-[11px] mt-2" style={{ color: C.amber }}>{s.pagesFull}</p>
          )}
        </div>
      )}

      {preview && !pages.length && (
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

      {pages.length > 0 ? (
        <div className="flex gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy || pagesRefused > 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ border: `1px solid ${C.hairline}`, color: C.ink }}
          >
            <Plus size={16} /> {s.addPage}
          </button>
          <button
            onClick={readPages}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
            {busy ? spinner : pages.length === 1 ? s.readOnePage : fill(s.readPages, { n: pages.length })}
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : preview ? <RotateCcw size={16} /> : <Camera size={16} />}
          {busy ? spinner : preview ? s.retake : buttonLabel || s.take}
        </button>
      )}

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
