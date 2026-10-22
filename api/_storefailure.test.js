/* What happens when the store is configured and cannot be reached.

   This is the only test file that deliberately runs against a non-memory
   backend. Every other one refuses to start unless `backend === "memory"`,
   because they write fixture accounts and against a real Redis would write
   them into live records. The address used here is `127.0.0.1:1` — a port
   nothing can listen on — so the backend is configured, every call fails
   immediately, and there is no store in existence for it to damage.

   It exists because the production Redis went away and the app did not say
   so. A failed read returned null, which is also what a missing key returns;
   a failed write returned false, which nothing checks; a failed scan returned
   an empty array. So the symptoms were: nobody could sign in (reported as
   wrong credentials), every stock balance read as zero, and anything typed in
   was accepted and discarded, because each function fell through to a
   per-invocation Map that dies with the request.

   None of that looked like an outage. That is the whole problem — and it is
   why these assertions are about refusing to answer rather than about
   answering correctly. */

process.env.KV_REST_API_URL = "http://127.0.0.1:1/";
process.env.KV_REST_API_TOKEN = "not-a-real-token";
delete process.env.REDIS_URL;
delete process.env.KV_URL;
/* Postgres outranks Redis in `_store.js`, so leaving either of these set
   would quietly make `backend` "pg" and test a backend that works. */
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

import assert from "node:assert/strict";

const store = await import("./_store.js");
const {
  getJSON, setJSON, del, listKeys, backend, persistent,
  unavailable, handledUnavailable, StorageUnavailable,
} = store;

if (backend !== "http" || !persistent) {
  console.error(`Refusing to run: backend is "${backend}", expected a configured one.`);
  process.exit(1);
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* Quietens the module's own console.error for the duration — these tests
   provoke dozens of real failures and the log is the point of the code, not
   of the output. */
const realError = console.error;
const hush = () => { console.error = () => {}; };
const unhush = () => { console.error = realError; };

function fakeRes() {
  const r = {
    code: null, body: null, headers: {},
    setHeader(k, v) { r.headers[k] = v; return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

await test("a read that fails throws, rather than reading as absent", async () => {
  hush();
  await assert.rejects(() => getJSON("acct:someone"), (err) => {
    assert.equal(err.name, "StorageUnavailable", "named so routes can recognise it");
    assert.equal(err.operation, "read");
    assert.ok(err.cause, "keeps the underlying failure");
    return true;
  });
  unhush();
});

await test("a write that fails throws, rather than returning a false nobody reads", async () => {
  hush();
  await assert.rejects(() => setJSON("acct:someone", { username: "someone" }),
    (err) => err.name === "StorageUnavailable" && err.operation === "write");
  unhush();
});

await test("a failed write is not quietly kept in memory instead", async () => {
  hush();
  /* The fall-through that used to sit at the bottom of every function. On a
     serverless platform that Map belongs to one invocation, so the delivery
     was gone before the response finished — and the next read found nothing,
     having reported success. */
  await assert.rejects(() => setJSON("inv:org:moves:b1", [{ qtyBase: 5000 }]));
  await assert.rejects(() => getJSON("inv:org:moves:b1"),
    (err) => err.name === "StorageUnavailable");
  unhush();
});

await test("a failed scan throws, rather than reading as nothing there", async () => {
  hush();
  /* `listKeys` is how the admin panel enumerates accounts and how the ledger
     migration finds every ledger. An empty array means "this business has no
     stock ledgers", which is a sentence a backfill would act on. */
  await assert.rejects(() => listKeys("inv:"),
    (err) => err.name === "StorageUnavailable" && err.operation === "listKeys");
  unhush();
});

await test("a failed delete throws", async () => {
  hush();
  await assert.rejects(() => del("acct:someone"),
    (err) => err.name === "StorageUnavailable" && err.operation === "delete");
  unhush();
});

await test("unavailable() recognises it by name, not identity", () => {
  assert.equal(unavailable(new StorageUnavailable("read", new Error("x"))), true);
  assert.equal(unavailable({ name: "StorageUnavailable" }), true, "a copy from another module instance");
  assert.equal(unavailable(new Error("something else")), false);
  assert.equal(unavailable(null), false);
});

await test("handledUnavailable answers 503 and Retry-After, and leaves other errors alone", () => {
  const res = fakeRes();
  assert.equal(handledUnavailable(res, new StorageUnavailable("read", new Error("x"))), true);
  assert.equal(res.code, 503, "not 500: the request was fine and will work later");
  assert.deepEqual(res.body, { error: "storage" });
  assert.equal(res.headers["Retry-After"], "30");

  /* The important half. A real bug must not be dressed up as an outage, or
     every 500 in the app becomes "try again later" and nobody looks. */
  const other = fakeRes();
  assert.equal(handledUnavailable(other, new TypeError("undefined is not a function")), false);
  assert.equal(other.code, null, "wrote nothing");
});

await test("requireAuth says 503, not that the session expired", async () => {
  const { requireAuth, issueToken } = await import("./_auth.js");
  const res = fakeRes();
  hush();
  const session = await requireAuth(
    { headers: { authorization: `Bearer ${issueToken("someone", 0)}` } }, res);
  unhush();

  assert.equal(session, null, "still refuses the request");
  /* The lie this replaces: a 401 told the owner their password had stopped
     working, when the truth was that the database had gone. One of those
     invites you to re-register and overwrite real records. */
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, { error: "storage" });
});

await test("requireAuth still says 401 for a token that is actually invalid", async () => {
  const { requireAuth } = await import("./_auth.js");
  const res = fakeRes();
  assert.equal(await requireAuth({ headers: { authorization: "Bearer nonsense" } }, res), null);
  assert.equal(res.code, 401, "a bad signature is not an outage");
});

await test("sign-in says 503, not wrong credentials", async () => {
  const login = (await import("./login.js")).default;
  const res = fakeRes();
  hush();
  await login({ method: "POST", body: { username: "someone", password: "whatever" } }, res);
  unhush();
  assert.equal(res.code, 503, "401 here sends somebody to reset a password that was never wrong");
  assert.deepEqual(res.body, { error: "storage" });
});

await test("registration says 503, and never a cheerful 200", async () => {
  const register = (await import("./register.js")).default;
  const res = fakeRes();
  hush();
  await register({ method: "POST", body: {
    username: "newperson", password: "Str0ng-Passw0rd!9", email: "new@example.com",
  } }, res);
  unhush();

  /* The `persistent` flag already warned when no store was configured. A
     store that is configured and dead sets it true, so this was a 200 with a
     token, an account object, and no account. */
  assert.equal(res.code, 503);
  assert.equal(res.body?.token, undefined, "no token for an account that was not written");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
