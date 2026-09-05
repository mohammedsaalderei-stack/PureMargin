/* What the scanner accepts, and what it says when it will not.

   The bug these exist for: every refusal — malformed, wrong type, too big,
   and a PDF a picker had failed to label — came back as one error, which the
   screen rendered as "the photo couldn't be read, try again in better light".
   Told that about a PDF, somebody reasonably concludes the feature is broken.
   There is no lighting on a document. */

import assert from "node:assert/strict";
import { parseDataUrl, contentBlock } from "./ai.js";

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

test("a properly labelled PDF is read as a document", () => {
  const out = parseDataUrl(url("application/pdf", PDF_BODY));
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
  const jpeg = parseDataUrl(url("image/jpeg", "\xFF\xD8\xFFnot a pdf"));
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

test("too big is its own answer, with the limit in it", () => {
  /* A person told a file is too big can send fewer pages. A person told to
     improve the lighting can do nothing at all. */
  const huge = parseDataUrl(`data:image/jpeg;base64,${"A".repeat(12 * 1024 * 1024)}`);
  assert.equal(huge.error, "toolarge");
  assert.equal(huge.limitMb, 8);
});

test("a PDF gets more room than a photograph, because it is not downscaled", () => {
  /* Photographs are resized to 1600px in the browser before they are sent.
     A PDF is sent whole — its text layer is the reason it beats a photo of
     the same page — so a scanned multi-page invoice needs the headroom. */
  const bytes = 12 * 1024 * 1024;
  const body = `${PDF_BODY}${"x".repeat(bytes)}`;
  const out = parseDataUrl(url("application/pdf", body));
  assert.equal(out.error, undefined, "12 MB of PDF is fine");
  assert.equal(out.kind, "document");

  const tooBig = parseDataUrl(url("application/pdf", `${PDF_BODY}${"x".repeat(25 * 1024 * 1024)}`));
  assert.equal(tooBig.error, "toolarge");
  assert.equal(tooBig.limitMb, 20);
});

test("a document and an image become different content blocks", () => {
  /* Sending a PDF as an image block is rejected by the API outright rather
     than degraded, so the distinction has to survive to the request. */
  assert.equal(contentBlock(parseDataUrl(url("application/pdf", PDF_BODY))).type, "document");
  assert.equal(contentBlock(parseDataUrl(url("image/png", "pixels"))).type, "image");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
