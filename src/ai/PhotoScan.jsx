import { useRef, useState, useEffect } from "react";
import { Camera, Loader2, RotateCcw, FileText } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Take or choose a photo, send it to the AI, hand the parsed result up.

   One component for every photo-analysis job in the app: the bill scanner
   and the inventory reader differ only in `kind` and in how the parent
   renders the result. Images are downscaled client-side so a 12MP photo
   doesn't ride the request. */

/* A PDF is read straight through.

   Downscaling only makes sense for a photograph. `createImageBitmap` throws on
   a PDF, so routing everything through it was what limited this to camera
   input — and a PDF invoice sent by a supplier is a perfect copy that should
   not be photographed to be read. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

async function toDataUrl(file, maxDim = 1600) {
  if (file.type === "application/pdf") return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function PhotoScan({ token, kind, onResult, buttonLabel }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.aiscan;
  const inputRef = useRef(null);
  const [preview, setPreview] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    try {
      const image = await toDataUrl(file);
      setPreview(image);
      setFileName(file?.name || "");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, image, lang }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        /* A spent allowance is not a failure of the photo, and saying "the
           photo couldn't be read" would send somebody outside to retake it. */
        setError(json.error === "locked" ? s.locked
          : json.error === "quota" ? s.quotaOut
          : s.failed);
        if (json.error === "quota") setScans({ left: 0 });
        return;
      }
      if (json.scans) setScans(json.scans);
      /* The depletion plan rides alongside the result rather than inside it:
         it is a proposal about stock, not part of what the photo said. */
      onResult(json.result, image, json.depletion || null);
    } catch {
      setError(s.failed);
    } finally {
      setBusy(false);
    }
  }

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
          {/* A PDF has nothing to show in an <img>, and a broken image icon
              reads as the upload having failed. Name the file instead. */}
          {preview.startsWith("data:application/pdf")
            ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm"
                style={{ opacity: busy ? 0.5 : 1, color: C.slate }}>
                <FileText size={18} style={{ color: C.iris }} />
                <span className="truncate">{fileName || s.pdfReady}</span>
              </div>
            )
            : <img src={preview} alt="" className="w-full max-h-56 object-cover" style={{ opacity: busy ? 0.5 : 1 }} />}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold"
              style={{ background: "rgba(0,0,0,0.35)", color: "#fff" }}>
              <Loader2 size={16} className="animate-spin" /> {s.analyzing}
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
        {busy ? s.analyzing : preview ? s.retake : buttonLabel || s.take}
      </button>

      {scans && scans.left !== undefined && !error && (
        <p className="text-[11px] mt-2" style={{ opacity: 0.7 }}>
          {fill(s.quotaLeft, { n: scans.left })}
        </p>
      )}
      {error && <p className="text-xs mt-2" style={{ color: C.rose }}>{error}</p>}
    </div>
  );
}
