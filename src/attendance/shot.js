/* A photograph of the place, small enough to send from a phone on a bad
   connection.

   ── Why it is shrunk here and not on the server ──────────────────────────

   A modern phone camera produces something like twelve megapixels and three
   to five megabytes. Vercel refuses a request body over 4.5MB before the
   function is ever invoked, so an untouched photograph is not a slow upload —
   it is a failure with no error to read, which is exactly the bug that took a
   day to find when documents were being sent whole. The picture is downscaled
   before it goes anywhere near the wire.

   Nothing is lost that matters. This is evidence that somebody was standing
   outside a particular restaurant; a thousand pixels across is more than
   enough to recognise a shopfront, and the same photograph at twelve megapixels
   costs thirty times as much of a cook's mobile data to prove the same thing.

   ── Two sizes ────────────────────────────────────────────────────────────

   The owner's screen draws a day as a strip of small pictures and opens one
   only when asked, so both are made here in the one pass the browser already
   has the decoded image for. Making the thumbnail later would mean decoding
   the photograph a second time. */

export const FULL_MAX_DIM = 1000;
export const THUMB_MAX_DIM = 160;

/* Kept a little under the server's own ceiling so a photograph that is
   borderline here is not refused there. */
export const FULL_MAX_CHARS = 650_000;
export const THUMB_MAX_CHARS = 28_000;

export class ShotError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/* Decoded with its rotation already applied.

   A phone held upright writes a landscape image plus an EXIF tag saying which
   way up it goes. `drawImage` does not read that tag, so without asking for it
   every photograph taken in portrait — which is every photograph taken by
   somebody holding a phone — arrives at the owner on its side.

   `imageOrientation` is ignored by older browsers rather than throwing, so the
   fallback is the same call without it: a sideways picture is still a picture,
   and refusing to record an arrival over it would be the wrong trade. */
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new ShotError("unreadable");
    }
  }
}

function draw(bitmap, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext("2d");
  /* A JPEG has no transparency, and an unpainted canvas encodes as black.
     White is what a photograph with an odd aspect ratio should be letterboxed
     against, on the rare occasion any of it shows. */
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const url = canvas.toDataURL("image/jpeg", quality);
  /* Releasing the backing store rather than waiting for collection. Two
     full-size canvases held at once is how a phone tab gets killed. */
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

/* Encode, and step the quality down until it fits.

   A detailed photograph — a busy street, a shelf of stock — compresses worse
   than a plain shopfront, so a fixed quality is a size that varies by subject.
   Rather than guess low for everybody, this starts where a photograph looks
   right and gives ground only when it has to. */
function encodeWithin(bitmap, maxDim, limit, qualities) {
  let last = "";
  for (const q of qualities) {
    last = draw(bitmap, maxDim, q);
    if (last.length <= limit) return last;
  }
  /* Still too big at the lowest quality: shrink the picture instead. */
  const smaller = draw(bitmap, Math.round(maxDim * 0.6), qualities[qualities.length - 1]);
  if (smaller.length <= limit) return smaller;
  throw new ShotError("toobig");
}

export async function prepareShot(file) {
  if (!file) throw new ShotError("missing");
  if (!String(file.type || "").startsWith("image/")) throw new ShotError("notphoto");

  const bitmap = await decode(file);
  try {
    return {
      full: encodeWithin(bitmap, FULL_MAX_DIM, FULL_MAX_CHARS, [0.72, 0.6, 0.48, 0.38]),
      thumb: encodeWithin(bitmap, THUMB_MAX_DIM, THUMB_MAX_CHARS, [0.62, 0.5, 0.4]),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close?.();
  }
}
