/* What the scanner accepts, and what it says when it will not.

   The bug these exist for came in two halves, and the second half hid behind
   the first.

   Half one: every refusal — malformed, wrong type, too big, and a PDF a picker
   had failed to label — came back as one error, which the screen rendered as
   "the photo couldn't be read, try again in better light". Told that about a
   PDF, somebody reasonably concludes the feature is broken. There is no
   lighting on a document.

   Half two: the size limit written in this file was fiction. These routes are
   Vercel functions, and a Vercel function may be handed a request body of at
   most 4.5 MB — past that the platform answers 413 itself and the handler is
   never invoked. A cap of twenty megabytes here described requests that had
   already been refused without our wording. So the enforcement moved to the
   browser (`src/ai/attach.js`, which renders an oversized PDF to page images
   rather than turning it away), and what is left here is a backstop set to
   what can actually arrive. */

import assert from "node:assert/strict";
import { parseDataUrl, parseAttachments, contentBlock } from "./ai.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const b64 = (s) => Buffer.from(s, "latin1").toString("base64");
const url = (type, body) => `data:${type};base64,${b64(body)}`;

/* A minimal but genuine PDF header. Every PDF starts "%PDF-" by spec. */
const PDF_BODY = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n";
const PDF_URL = url("application/pdf", PDF_BODY);
const JPEG_URL = url("image/jpeg", "\xFF\xD8\xFFpixels");

test("a properly labelled PDF is read as a document", () => {
  const out = parseDataUrl(PDF_URL);
  assert.equal(out.error, undefined);
  assert.equal(out.kind, "document");
  assert.equal(out.mediaType, "application/pdf");
});

test("a PDF the browser failed to label is still read as a document", () => {
  /* Several Android pickers hand over a document with an empty `type`, which
     arrives here as application/octet-stream. Every one of those used to be
     refused, and refused with advice about lighting. */
  for (const wrong of ["application/octet-stream", "text/plain", "image/jpeg"]) {
    const out = parseDataUrl(url(wrong, PDF_BODY));
    assert.equal(out.kind, "document", `mislabelled as ${wrong}`);
    assert.equal(out.mediaType, "application/pdf", "corrected to what it is");
  }
});

test("the bytes outrank the label in both directions", () => {
  /* A JPEG is not turned into a document just because something said so. */
  const jpeg = parseDataUrl(JPEG_URL);
  assert.equal(jpeg.kind, "image");
  assert.equal(jpeg.mediaType, "image/jpeg");
});

test("an image is read as an image", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    assert.equal(parseDataUrl(url(type, "pretend pixels")).kind, "image", type);
  }
});

test("a file type nothing can read says so, and does not mention light", () => {
  const out = parseDataUrl(url("application/zip", "PK\x03\x04"));
  assert.equal(out.error, "unsupported");
  assert.equal(out.kind, undefined);
});

test("something that is not a data URL at all is named separately", () => {
  assert.equal(parseDataUrl("").error, "unreadable");
  assert.equal(parseDataUrl(null).error, "unreadable");
  assert.equal(parseDataUrl("https://example.com/a.pdf").error, "unreadable");
});

test("a single file still works, because most callers send one", () => {
  const out = parseAttachments({ image: PDF_URL });
  assert.equal(out.error, undefined);
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].kind, "document");
});

test("a PDF rendered to pages arrives as an ordered set of images", () => {
  /* The browser sends one image per page when a document is too large to send
     whole. They are one document, so order is part of the meaning: a line
     continued across a page break only reads as one line if page 2 follows
     page 1. */
  const pages = ["a", "b", "c"].map((p) => url("image/jpeg", `page-${p}`));
  const out = parseAttachments({ images: pages });
  assert.equal(out.files.length, 3);
  assert.deepEqual(
    out.files.map((f) => Buffer.from(f.data, "base64").toString("latin1")),
    ["page-a", "page-b", "page-c"],
  );
});

test("nothing attached is not the same as something unreadable", () => {
  assert.equal(parseAttachments({}).error, "unreadable");
  assert.equal(parseAttachments({ images: [] }).error, "unreadable");
});

test("the size limit is on the request, not on each file", () => {
  /* Checking every attachment against its own cap is what would let sixty
     three-megabyte pages through together — and the limit that actually bites
     is the platform's, which counts the whole body. */
  const oneMb = `data:image/jpeg;base64,${"A".repeat(1024 * 1024)}`;
  const four = parseAttachments({ images: Array(4).fill(oneMb) });
  assert.equal(four.error, undefined, "3 MB of pages is fine");

  const sixteen = parseAttachments({ images: Array(16).fill(oneMb) });
  assert.equal(sixteen.error, "toolarge");
  assert.equal(sixteen.limitMb, 5, "rounded from the platform's 4.5 MB body limit");
});

test("too big is its own answer, and never advice about lighting", () => {
  /* A person told a file is too big can send fewer pages. A person told to
     improve the lighting can do nothing at all. */
  const huge = parseAttachments({ image: `data:image/jpeg;base64,${"A".repeat(9 * 1024 * 1024)}` });
  assert.equal(huge.error, "toolarge");
  assert.ok(huge.limitMb > 0, "the limit is stated, so the message can name it");
});

test("the backstop is not larger than the platform will deliver", () => {
  /* The regression that started all this: a 20 MB cap here meant a 6 MB
     invoice was refused by Vercel with a 413 our code never saw, and the
     browser fell through to its last-resort message. Whatever this file
     enforces, it cannot exceed what can physically arrive. */
  const overPlatform = `data:application/pdf;base64,${Buffer.from(PDF_BODY, "latin1").toString("base64")}${"A".repeat(6 * 1024 * 1024)}`;
  assert.equal(parseAttachments({ image: overPlatform }).error, "toolarge");
});

test("an implausible number of attachments is refused before it is decoded", () => {
  const many = Array(80).fill(JPEG_URL);
  assert.equal(parseAttachments({ images: many }).error, "toomany");
});

test("a bad page in the middle names its own fault", () => {
  const out = parseAttachments({ images: [JPEG_URL, url("application/zip", "PK"), JPEG_URL] });
  assert.equal(out.error, "unsupported");
});

test("a document and an image become different content blocks", () => {
  /* Sending a PDF as an image block is rejected by the API outright rather
     than degraded, so the distinction has to survive to the request. */
  assert.equal(contentBlock(parseDataUrl(PDF_URL)).type, "document");
  assert.equal(contentBlock(parseDataUrl(url("image/png", "pixels"))).type, "image");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
