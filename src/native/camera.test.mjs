/* Turning what the camera plugin returns into the File the rest of the app
   already knows how to handle.

   Worth testing on its own because the failure is quiet and late: a
   photograph that decodes wrongly still uploads, still attaches to a name and
   a time, and is only discovered when somebody opens it during a dispute
   about whether a person was at work. By then the shift is weeks gone. */

import assert from "node:assert/strict";
import { fileFromBase64, nativeCameraAvailable } from "./camera.js";

/* Awaited. Half of these assertions read the File's bytes, which is async —
   a synchronous runner would report "ok" before the assertion had run and a
   rejection would land in an unhandled promise nobody is watching. */
let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* The first bytes of a real JPEG: SOI marker, APP0, "JFIF". Enough that a
   decoder would accept the header, and enough that a byte lost in the
   conversion shows up as a different number. */
const JPEG_BYTES = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
const JPEG_B64 = Buffer.from(JPEG_BYTES).toString("base64");

async function bytesOf(file) {
  return new Uint8Array(await file.arrayBuffer());
}

await test("the bytes survive the decode exactly", async () => {
  const file = fileFromBase64(JPEG_B64);
  assert.ok(file, "produced a file");
  assert.deepEqual([...(await bytesOf(file))], JPEG_BYTES);
});

await test("it is a File the upload path can use", async () => {
  const file = fileFromBase64(JPEG_B64);
  assert.ok(file instanceof File, "a File, which is what prepareShot takes");
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.name, "clockin.jpg");
  assert.equal(file.size, JPEG_BYTES.length);
});

await test("a high byte is not mangled on the way through", async () => {
  /* 0xFF is where a naive string conversion goes wrong: read as UTF-16 or
     passed through TextEncoder it becomes two bytes, and every JPEG starts
     with two of them. */
  const high = [0xFF, 0xFE, 0x80, 0x7F, 0x00];
  const file = fileFromBase64(Buffer.from(high).toString("base64"));
  assert.deepEqual([...(await bytesOf(file))], high);
});

await test("a data URL is accepted as well as bare base64", async () => {
  /* The plugin returns bare base64, but the same function is the obvious
     place to send a data URL from elsewhere, and silently decoding the
     prefix as image data would corrupt every byte. */
  const file = fileFromBase64(`data:image/jpeg;base64,${JPEG_B64}`);
  assert.deepEqual([...(await bytesOf(file))], JPEG_BYTES);
});

await test("the format reported by the camera is carried onto the file", () => {
  const file = fileFromBase64(JPEG_B64, { type: "image/png", name: "clockin.png" });
  assert.equal(file.type, "image/png");
  assert.equal(file.name, "clockin.png");
});

await test("nothing, or nonsense, produces null rather than an empty photograph", () => {
  /* A zero-byte File would upload, store, and display as a broken image
     against somebody's name. Null is refusable; an empty photo is not. */
  for (const bad of ["", null, undefined, 123, {}]) {
    assert.equal(fileFromBase64(bad), null, String(bad));
  }
  assert.equal(fileFromBase64("not base64 !!!"), null, "undecodable");
});

await test("the native camera is not offered in a browser", () => {
  assert.equal(nativeCameraAvailable({}), false);
  assert.equal(nativeCameraAvailable({ Capacitor: { isNativePlatform: () => false } }), false);
  assert.equal(nativeCameraAvailable({ Capacitor: { isNativePlatform: () => true } }), true);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
