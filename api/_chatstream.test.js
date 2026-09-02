/* The wire format between api/chat.js and the Ask screen.

   This is a contract with no enforcement anywhere else in the system, and
   breaking it is silent. The server writes a frame, the stream completes
   normally, the client accumulates nothing, and the question comes back blank
   — no error logged, no failed request, nothing to point at.

   That is not hypothetical. The tool loop was written to emit Anthropic's own
   `content_block_delta` envelope, which carries its text at
   `delta.text` rather than at the top level. `src/screens/Ask.jsx` reads
   `evt.text`, found undefined, appended nothing, and every question that used
   a tool produced an empty answer that had in fact been generated correctly.

   So: one helper defines the shape, these tests pin it, and the last test
   refuses any frame written without going through the helper. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { sseText, sseError, SSE_DONE } = await import("./chat.js");

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

/* What Ask.jsx does with a line, reduced to its essentials: split off the
   `data:` prefix, parse, take `.text`, throw on `.error`. */
function readFrame(frame) {
  const line = frame.split("\n").find((l) => l.startsWith("data:"));
  assert.ok(line, "a frame must have a data: line");
  const raw = line.slice(5).trim();
  if (raw === "[DONE]") return { done: true };
  return JSON.parse(raw);
}

test("a text frame carries its text at the top level", () => {
  const evt = readFrame(sseText("Your food cost is 31%."));
  assert.equal(evt.text, "Your food cost is 31%.");
  /* The shape that broke it: text nested under a delta. */
  assert.equal(evt.delta, undefined);
  assert.equal(evt.type, undefined);
});

test("an error frame carries its message at the top level", () => {
  const evt = readFrame(sseError("Stream failed."));
  assert.equal(evt.error, "Stream failed.");
  assert.equal(evt.text, undefined);
});

test("frames are separated by a blank line, as SSE requires", () => {
  assert.ok(sseText("a").endsWith("\n\n"));
  assert.ok(sseError("b").endsWith("\n\n"));
  assert.ok(SSE_DONE.endsWith("\n\n"));
});

test("text containing newlines survives the frame intact", () => {
  /* An answer is two or three paragraphs, so this is the normal case rather
     than an edge one — a raw newline in the payload would split the frame and
     truncate the answer at the first paragraph. */
  const answer = "First line.\n\nSecond line.";
  const frame = sseText(answer);
  assert.equal(frame.split("\n\n").length - 1, 1, "only the terminator may be a blank line");
  assert.equal(readFrame(frame).text, answer);
});

test("the done sentinel is recognisable and carries nothing", () => {
  assert.deepEqual(readFrame(SSE_DONE), { done: true });
});

test("every frame the route writes goes through the helper", () => {
  /* The structural half. A raw `res.write(\`data: ...\`)` anywhere in the route
     is a second definition of the wire format, and a second definition is how
     the first one gets forgotten. */
  const src = fs.readFileSync(path.join(HERE, "chat.js"), "utf8");
  const writes = [...src.matchAll(/res\.write\(([^\n]*)\)/g)].map((m) => m[1]);

  assert.ok(writes.length >= 4, "expected the route to write frames");
  for (const call of writes) {
    assert.ok(
      /^(sseText|sseError|SSE_DONE)/.test(call.trim()),
      `raw frame written outside the helper: res.write(${call})`,
    );
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
