/* Pictures of menu items (`_itemimages.js`, `_imageurl.js`, `api/itemimage.js`).

   What this protects: only real pictures are kept, and not huge ones; an
   address works for exactly one business's item at one version, so it can be
   neither edited into somebody else's picture nor keep serving a picture that
   was replaced; and the catalogue names the picture so the till can draw it. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { saveImage, removeImage, MAX_IMAGE_BYTES } = await import("./_itemimages.js");
const { imageUrl, verifyImageUrl } = await import("./_imageurl.js");
const route = (await import("./itemimage.js")).default;
const till = await import("./_till.js");
const setup = await import("./_tillsetup.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]).toString("base64");
const params = (url) => Object.fromEntries(new URL(url, "http://x").searchParams);
const get = async (query) => {
  const r = { code: 0, headers: {}, body: null, statusCode: 0, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end(b) { r.code = r.statusCode; r.body = b; } };
  await route({ method: "GET", query }, r);
  return r;
};

await test("only real pictures are kept, from their bytes, and not huge ones", async () => {
  assert.equal((await saveImage("org1", "fries", `data:image/jpeg;base64,${JPEG}`)).type, "image/jpeg");
  assert.equal((await saveImage("org1", "fries", PNG)).type, "image/png");
  assert.equal((await saveImage("org1", "fries", Buffer.from("<svg onload=alert(1)>").toString("base64"))).error, "type",
    "a file calling itself a picture is not one");
  assert.equal((await saveImage("org1", "fries", "not base64 !!")).error, "image");
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_IMAGE_BYTES)]).toString("base64");
  assert.equal((await saveImage("org1", "fries", big)).error, "toolarge");
});

await test("an address names one business's item at one version", async () => {
  const q = params(imageUrl("org1", "fries", "abc123"));
  assert.equal(verifyImageUrl(q), true);
  assert.equal(verifyImageUrl({ ...q, o: "org2" }), false, "another business");
  assert.equal(verifyImageUrl({ ...q, i: "burger" }), false, "another item");
  assert.equal(verifyImageUrl({ ...q, v: "zzz999" }), false, "another version");
  assert.equal(verifyImageUrl({ ...q, s: "" }), false);
});

await test("the picture is served, cacheable for good, and stops when replaced or removed", async () => {
  const first = await saveImage("org1", "fries", JPEG);
  const served = await get(params(first.url));
  assert.equal(served.code, 200);
  assert.equal(served.headers["Content-Type"], "image/jpeg");
  assert.match(served.headers["Cache-Control"], /immutable/);
  assert.ok(Buffer.isBuffer(served.body));

  const second = await saveImage("org1", "fries", PNG);
  assert.notEqual(second.url, first.url);
  assert.equal((await get(params(first.url))).code, 404, "the old address no longer serves the old picture");
  assert.equal((await get(params(second.url))).code, 200);

  await removeImage("org1", "fries");
  assert.equal((await get(params(second.url))).code, 404);
  assert.equal((await get({ ...params(second.url), o: "org2" })).code, 403);
});

await test("the catalogue names each item's picture", async () => {
  const saved = await setup.saveProduct("org1", { name: "Soda", price: 3.5 });
  await saveImage("org1", saved.id, JPEG);
  const items = till.catalogueOf([], await till.getSettings("org1"), { orgId: "org1" });
  const soda = items.find((i) => i.name === "Soda");
  assert.match(soda.image, /^\/api\/itemimage\?/);
  assert.equal(verifyImageUrl(params(soda.image)), true);
  assert.equal(till.catalogueOf([], await till.getSettings("org1")).find((i) => i.name === "Soda").image, null,
    "no organization, no address");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
