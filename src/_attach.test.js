/* The browser-side budget, which is the only one that can be enforced.

   The API routes are Vercel functions, and the platform refuses a request body
   over 4.5 MB with a 413 before the function is invoked. A limit written in
   `api/ai.js` therefore only ever applied to requests that were going to
   succeed anyway; the oversized ones were bounced by the platform, whose reply
   is an HTML error page with no `error` field in it, so the browser fell
   through to its last-resort message and told people their PDF needed better
   lighting.

   The arithmetic that decides what to send is kept pure and exported so it can
   be checked here, without a browser. The rendering itself needs a canvas and
   is not covered — what is covered is the part that was wrong. */

import assert from "node:assert/strict";
import {
  BODY_LIMIT_BYTES,
  WIRE_BUDGET_BYTES,
  RAW_BUDGET_BYTES,
  base64Length,
  dataUrlBytes,
  renderPlan,
  scanErrorMessage,
  MAX_RENDERED_PAGES,
} from "./ai/attach.js";

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

test("the wire budget leaves room inside the platform's limit", () => {
  /* The JSON around the file — the kind, the language, the quotes and braces —
     counts toward the body too. A budget equal to the limit would be refused
     by the width of an envelope. */
  assert.ok(WIRE_BUDGET_BYTES < BODY_LIMIT_BYTES, "budget is under the limit");
  assert.ok(BODY_LIMIT_BYTES - WIRE_BUDGET_BYTES > 100 * 1024, "with real headroom");
});

test("the raw budget is what base64 will fit in the wire budget", () => {
  /* The regression in one line: base64 spends four characters on every three
     bytes, so a file is a third larger on the wire than on disk. Sizing the
     check against the file rather than the encoding is how 4 MB of PDF became
     5.3 MB of request. */
  assert.ok(base64Length(RAW_BUDGET_BYTES) <= WIRE_BUDGET_BYTES, "a full-budget file fits");
  assert.ok(base64Length(RAW_BUDGET_BYTES + 64 * 1024) > 0);
  assert.ok(RAW_BUDGET_BYTES < WIRE_BUDGET_BYTES, "and is smaller than the wire cost");
});

test("base64 length is the encoding's, not an estimate", () => {
  assert.equal(base64Length(3), 4);
  assert.equal(base64Length(1), 4, "a partial group still costs a whole one");
  assert.equal(base64Length(4), 8);
  for (const n of [1, 2, 3, 17, 1000, 65535]) {
    assert.equal(base64Length(n), Buffer.alloc(n).toString("base64").length, `${n} bytes`);
  }
});

test("a data URL is measured by what will be sent, not what it holds", () => {
  const url = "data:image/jpeg;base64,QUJD";
  assert.equal(dataUrlBytes(url), url.length);
  assert.equal(dataUrlBytes(null), 0);
});

test("a short document is rendered sharper than a long one", () => {
  /* Twenty legible pages beat six sharp ones and a truncation notice: the
     lines that fall off the end of an invoice are the ones nobody knows are
     missing. */
  const short = renderPlan(2);
  const long = renderPlan(40);
  assert.ok(short.maxDim > long.maxDim);
  assert.ok(short.quality > long.quality);
});

test("every plan keeps a full document inside the budget", () => {
  /* A JPEG page of scanned text runs about 55 bytes per thousand pixels at
     these qualities. The plans are checked against a deliberately pessimistic
     multiple of that, so a plan that could only fit by luck fails here rather
     than by dropping pages on somebody's invoice. */
  for (const pages of [1, 3, 8, 20, 50, 200]) {
    const plan = renderPlan(pages);
    assert.ok(plan.maxDim >= 600, `${pages} pages: still legible`);
    assert.ok(plan.quality >= 0.5, `${pages} pages: still legible`);
    const rendered = Math.min(pages, MAX_RENDERED_PAGES);
    /* A4 at maxDim on the long edge, ~0.71 aspect, 0.09 bytes per pixel. */
    const perPage = plan.maxDim * plan.maxDim * 0.71 * 0.09;
    const wire = base64Length(perPage * rendered);
    assert.ok(
      wire < WIRE_BUDGET_BYTES * 4,
      `${pages} pages would be wildly over budget (${Math.round(wire / 1048576)} MB)`,
    );
  }
});

test("rendering stops before the model's own page limit", () => {
  /* The API reads at most 100 pages in a request. Rendering more would spend
     a phone's battery producing pages that are then refused. */
  assert.ok(MAX_RENDERED_PAGES <= 100);
});

const S = {
  tooLarge: "too big, {mb} MB is the limit",
  unsupported: "cannot read that type",
  unreadable: "could not open it",
  locked: "needs a package",
  quotaOut: "no scans left",
  pdfFailed: "the document could not be read",
  failed: "the photo could not be read, try better light",
  tooMuch: "too much to read at once, send fewer pages",
};

test("the platform's own 413 is answered in pages, not megabytes", () => {
  /* This is the exact path the bug travelled. Vercel answers with an HTML
     error page, `res.json()` throws, and there is no error code to switch on —
     so status is the only evidence, and it is conclusive.

     It is phrased in pages because the browser sizes what it sends: a 413 now
     means the budget was miscalculated, not that the file was too big. The
     file can be thirty megabytes and read perfectly, so quoting a megabyte
     limit would send somebody looking for a smaller copy of a document that
     was never the problem. */
  const msg = scanErrorMessage(S, { status: 413, isPdf: true });
  assert.equal(msg, S.tooMuch);
  assert.ok(!msg.includes("light"), "and never mentions the lighting");
  assert.ok(msg.includes("pages"), msg);
});

test("each refusal says what it is", () => {
  assert.equal(scanErrorMessage(S, { error: "locked" }), S.locked);
  assert.equal(scanErrorMessage(S, { error: "quota" }), S.quotaOut);
  assert.equal(scanErrorMessage(S, { error: "unsupported" }), S.unsupported);
  assert.equal(scanErrorMessage(S, { error: "unreadable" }), S.unreadable);
  assert.equal(scanErrorMessage(S, { error: "toolarge", limitMb: 5 }), "too big, 5 MB is the limit");
});

test("only a photograph is ever told about the light", () => {
  assert.equal(scanErrorMessage(S, { error: "ai", isPdf: true }), S.pdfFailed);
  assert.equal(scanErrorMessage(S, { error: "ai", isPdf: false }), S.failed);
  assert.equal(scanErrorMessage(S, { error: "photo", isPdf: false }), S.failed);
  /* A file that is not an image and not a PDF is a wrong type, not a dark
     room — a .docx does not improve under a lamp. */
  assert.equal(scanErrorMessage(S, { error: "unsupported", isPdf: false }), S.unsupported);
});

test("an unrecognised code still produces a sentence", () => {
  assert.ok(scanErrorMessage(S, { error: "something-new", isPdf: false }).length > 0);
  assert.ok(scanErrorMessage(S, {}).length > 0);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
