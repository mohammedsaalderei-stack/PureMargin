/* Turning a chosen file into a request the server is allowed to receive.

   ── The bug this exists for ──────────────────────────────────────────────

   PDF scanning failed, and said "the document couldn't be read — try a
   clearer copy". The document was fine. It never reached the model, and it
   never reached our own code either.

   The API routes are Vercel functions, and a Vercel function may receive a
   request body of at most 4.5 MB. Over that the platform answers 413
   FUNCTION_PAYLOAD_TOO_LARGE itself and the function is never invoked. Base64
   inflates a file by a third, so a PDF larger than about 3.3 MB was refused by
   the platform before `api/ai.js` had a chance to look at it — and because the
   refusal is not our JSON, the browser fell through to its last-resort message
   and blamed the document.

   A photograph never hit this: it is downscaled to 1600px first, so it arrives
   a few hundred kilobytes. A PDF was sent whole. A scanned invoice — the exact
   thing a supplier sends, and the exact thing somebody most wants to scan — is
   routinely five to thirty megabytes.

   ── What this does about it ──────────────────────────────────────────────

   A PDF that fits is still sent whole, because its text layer is read directly
   rather than recognised out of pixels, and that is more accurate than any
   photograph of the same page. A PDF that does not fit is rendered to page
   images in the browser and those are sent instead: bigger than the text
   layer in fidelity terms, but they fit, and a slightly less accurate read of
   the real document beats a perfect read of nothing.

   The size ceiling therefore moves from "3 MB" to "as many pages as fit once
   they are pictures", which for a scanned invoice is most of them.

   ── Why the budget lives here and not on the server ──────────────────────

   Because the server cannot enforce it. The platform refuses the request
   before our code runs, so a limit expressed in `api/ai.js` is a limit that
   only applies to requests that were already going to succeed. The browser is
   the only place that can decline to send too much, and therefore the only
   place that can say why. */

/* The platform's hard limit on a function's request body. Not ours to change:
   https://vercel.com/docs/functions/limitations#request-body-size */
export const BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/* What we will actually put on the wire, leaving room for the JSON envelope
   around it — the kind, the language, the quotes and braces. */
export const WIRE_BUDGET_BYTES = 4 * 1024 * 1024;

/* base64 spends four characters on every three bytes, so this is the raw file
   size that encodes within the wire budget: about 3 MB. */
export const RAW_BUDGET_BYTES = Math.floor((WIRE_BUDGET_BYTES * 3) / 4);

/* How large a file is once it is base64. The `+ 3` rounds the group up. */
export function base64Length(rawBytes) {
  return Math.ceil(rawBytes / 3) * 4;
}

/* The cost of a data URL we already hold, without decoding it. */
export function dataUrlBytes(url) {
  return String(url || "").length;
}

/* How hard to render, chosen from how many pages there are.

   One pass, not a search: re-rendering a twenty-page scan three times over to
   creep up on the budget takes long enough on a phone to look like a hang. A
   short invoice gets rendered near photograph quality; a long one is rendered
   smaller, because twenty legible pages are worth more than six sharp ones and
   a truncation notice.

   Kept pure and exported so the arithmetic can be tested without a browser. */
export function renderPlan(pageCount) {
  if (pageCount <= 3) return { maxDim: 1600, quality: 0.75 };
  if (pageCount <= 8) return { maxDim: 1400, quality: 0.7 };
  if (pageCount <= 20) return { maxDim: 1100, quality: 0.65 };
  return { maxDim: 900, quality: 0.6 };
}

/* Rendering stops here however small the pages get. A 400-page document is not
   an invoice somebody is trying to file, and the model reads at most 100 pages
   in one request anyway. */
export const MAX_RENDERED_PAGES = 60;

/* Why a file was refused, in a form the caller can turn into a sentence. The
   codes match the ones `api/ai.js` returns, so both ends map through the same
   table and a refusal reads the same wherever it was decided. */
export class AttachError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    Object.assign(this, detail);
  }
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new AttachError("unreadable"));
    reader.readAsDataURL(file);
  });
}

/* Whether this is a PDF, decided by looking at it.

   `file.type` was once the only test, and several Android pickers hand over a
   document with that field empty — which arrives as application/octet-stream.
   Such a file went down the photograph path and threw.

   The first five bytes of a PDF are "%PDF-", by specification. The declared
   type and the file name are kept as fallbacks, but the bytes decide. */
export async function looksLikePdf(file) {
  if (file?.type === "application/pdf") return true;
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) === "%PDF-") return true;
  } catch { /* unreadable slice — fall through to the name */ }
  return String(file?.name || "").toLowerCase().endsWith(".pdf");
}

/* A photograph, downscaled. 12MP from a phone camera is far more detail than
   reading print off a page needs, and all of it would ride the request. */
async function photoToDataUrl(file, maxDim) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    /* Not an image and not a PDF. Say which, rather than implying the picture
       was blurry: nothing about the lighting will make a .docx readable. */
    throw new AttachError(
      String(file?.type || "").startsWith("image/") ? "photo" : "unsupported",
    );
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/* pdf.js, fetched only when a PDF that needs rendering actually turns up.

   The legacy build, deliberately: it is the transpiled one, and the phones
   this runs on in a restaurant are not always this year's phones. */
async function loadPdfjs() {
  const [lib, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

/* Render a PDF into page images that fit the budget.

   Pages are added while there is room and the rest are dropped, which the
   caller reports — reading eleven of fourteen pages silently would leave three
   pages of invoice lines missing with nothing on screen to suggest it. */
async function pdfToPages(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;

  const pageCount = doc.numPages;
  const plan = renderPlan(pageCount);
  const limit = Math.min(pageCount, MAX_RENDERED_PAGES);

  const dataUrls = [];
  let spent = 0;

  for (let n = 1; n <= limit; n += 1) {
    onProgress?.(n, pageCount);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(plan.maxDim / Math.max(base.width, base.height), 3);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    /* A PDF page is transparent where nothing is drawn, and transparent
       flattens to black in a JPEG. White is the paper. */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    /* `intent: "print"` is not about printing. It is pdf.js's own switch for
       whether the render loop is driven by requestAnimationFrame, and the
       display intent is — which means rendering stalls whenever the page is
       not visible, because a hidden tab is never handed a frame.

       That is not a hypothetical. Rendering a twenty-page scan takes several
       seconds on a phone, and glancing at a message while it works is the most
       ordinary thing in the world; on the display intent the scan would freeze
       there and only resume when the app came back. The print intent runs the
       same rasteriser on its own schedule and finishes either way. */
    await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;

    const url = canvas.toDataURL("image/jpeg", plan.quality);
    /* Free the backing store now rather than at the next collection. Twenty
       full-page canvases held at once is how a phone tab gets killed. */
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();

    const cost = dataUrlBytes(url);
    if (spent + cost > WIRE_BUDGET_BYTES) break;
    spent += cost;
    dataUrls.push(url);
  }

  doc.destroy();

  if (!dataUrls.length) throw new AttachError("toolarge", { limitMb: Math.round(RAW_BUDGET_BYTES / 1048576) });
  return { dataUrls, pageCount, sent: dataUrls.length };
}

/* Prepare a chosen file for `POST /api/ai`.

   Returns what to send and what happened to it, or throws an AttachError whose
   code names the refusal. */
export async function prepareFile(file, { onProgress } = {}) {
  if (!file) throw new AttachError("unreadable");

  const isPdf = await looksLikePdf(file);

  if (!isPdf) {
    return { isPdf: false, dataUrls: [await photoToDataUrl(file, 1600)], rasterised: false };
  }

  /* Small enough to send whole. Preferred: the text layer is read directly
     instead of being recognised out of pixels, so the numbers on a digital
     invoice come back exactly as the supplier typed them. */
  if (file.size <= RAW_BUDGET_BYTES) {
    const url = await readAsDataUrl(file);
    if (dataUrlBytes(url) <= WIRE_BUDGET_BYTES) {
      return { isPdf: true, dataUrls: [url], rasterised: false };
    }
  }

  try {
    const { dataUrls, pageCount, sent } = await pdfToPages(file, onProgress);
    return { isPdf: true, dataUrls, rasterised: true, pageCount, sent };
  } catch (err) {
    if (err instanceof AttachError) throw err;
    /* pdf.js could not open it — encrypted, truncated, or not really a PDF.
       If it would have fitted anyway, let the model have a look; the model
       reads some documents pdf.js will not. Otherwise there is nothing to
       send, and the honest answer is that it is too big. */
    if (file.size <= RAW_BUDGET_BYTES) {
      return { isPdf: true, dataUrls: [await readAsDataUrl(file)], rasterised: false };
    }
    throw new AttachError("toolarge", { limitMb: Math.round(RAW_BUDGET_BYTES / 1048576) });
  }
}

/* One refusal, one sentence — wherever it was decided.

   The browser, our route and the platform can each turn a scan down, and until
   now they said different things, or the same wrong thing.

   `status` catches the one case we cannot phrase ourselves: a 413 from the
   platform arrives as an HTML error page, so there is no `error` field to read
   and only the status says what happened. It is answered in pages rather than
   megabytes on purpose — the browser sizes what it sends, so a 413 can only
   mean the budget was miscalculated, and by then the file's own size is not
   the thing anybody can act on. A thirty-megabyte scan is fine here; thirty
   dense pages of one may not be. */
export function scanErrorMessage(s, { status, error, limitMb, isPdf } = {}) {
  if (status === 413) return s.tooMuch;
  switch (error) {
    case "locked": return s.locked;
    case "quota": return s.quotaOut;
    case "toolarge": return fillMb(s.tooLarge, limitMb || Math.round(RAW_BUDGET_BYTES / 1048576));
    case "unsupported": return s.unsupported;
    case "unreadable": return s.unreadable;
    case "photo": return s.failed;
    /* The model ran out of room before it ran out of document. Same answer as
       the platform's 413, because it is the same thing from the far end: there
       was more here than one reading holds, and fewer pages fixes it. */
    case "truncated": return s.tooMuch;
    /* The model answered, but not in a shape we could use. That is a fault at
       our end or a bad roll, not a fault of the document — telling somebody to
       find a clearer copy of a file that scanned perfectly is how a working
       document ends up being rescanned four times. */
    case "parse": return s.unexpected;
    /* No answer at all: the API refused or was down. Nothing about the file. */
    case "ai": return s.aiDown;
    case "noai": return s.aiDown;
    default: return isPdf ? s.pdfFailed : s.failed;
  }
}

function fillMb(text, mb) {
  return String(text).replace("{mb}", mb);
}
