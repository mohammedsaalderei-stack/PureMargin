/* Where accounts and conversations live.
   Serverless functions keep nothing between invocations, so this has to be
   external. Three backends are supported, picked automatically:

   1. REDIS_URL          — Redis Cloud and most other providers (TCP)
   2. KV_REST_API_URL    — Upstash and anything else speaking its HTTP API
   3. in-process Map     — local development only; lost on every cold start

   Both real backends are equally fine for this app. TCP needs the `redis`
   package and holds a connection open between invocations; HTTP needs no
   package and no connection at all, which suits serverless slightly better
   under bursty traffic. Whichever is attached, the rest of the code is
   unchanged. */

const REST_URL = process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN;
const TCP_URL = process.env.REDIS_URL || process.env.KV_URL;

export const persistent = Boolean((REST_URL && REST_TOKEN) || TCP_URL);
export const backend = REST_URL && REST_TOKEN ? "http" : TCP_URL ? "tcp" : "memory";

const memory = new Map();
let warned = false;

function warnOnce() {
  if (warned || persistent) return;
  warned = true;
  console.warn(
    "[sufra] No storage configured. Accounts and conversations are being held " +
      "in memory and will be lost on the next cold start. Attach Redis and set " +
      "either REDIS_URL, or KV_REST_API_URL with KV_REST_API_TOKEN."
  );
}

/* ---------------- TCP (Redis Cloud, node-redis) ---------------- */
/* One client per warm instance. Connecting on every call would be slower
   than the query itself and would exhaust the connection limit. */
let clientPromise = null;

async function tcpClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    let createClient;
    try {
      ({ createClient } = await import("redis"));
    } catch {
      // Package missing — fall back rather than take the whole request down.
      console.error("[sufra] REDIS_URL is set but the `redis` package isn't installed.");
      return null;
    }

    const client = createClient({
      url: TCP_URL,
      socket: { reconnectStrategy: (tries) => (tries > 5 ? false : Math.min(tries * 100, 1000)) },
    });
    client.on("error", (err) => console.error("[sufra] Redis error:", err.message));
    await client.connect();
    return client;
  })();

  const resolved = await clientPromise;
  // A failed connect shouldn't be cached forever; let the next call retry.
  if (!resolved) clientPromise = null;
  return resolved;
}

/* ---------------- HTTP (Upstash REST) ---------------- */
async function rest(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis REST responded ${res.status}`);
  const data = await res.json();
  return data.result;
}

/* ---------------- Public API ---------------- */
export async function getJSON(key) {
  warnOnce();
  try {
    if (backend === "tcp") {
      const client = await tcpClient();
      if (client) {
        const raw = await client.get(key);
        return raw ? JSON.parse(raw) : null;
      }
    } else if (backend === "http") {
      const raw = await rest(["GET", key]);
      return raw ? JSON.parse(raw) : null;
    }
  } catch (err) {
    console.error("[sufra] read failed:", err.message);
    return null;
  }
  const local = memory.get(key);
  return local ? JSON.parse(local) : null;
}

export async function setJSON(key, value) {
  warnOnce();
  const raw = JSON.stringify(value);
  try {
    if (backend === "tcp") {
      const client = await tcpClient();
      if (client) {
        await client.set(key, raw);
        return true;
      }
    } else if (backend === "http") {
      await rest(["SET", key, raw]);
      return true;
    }
  } catch (err) {
    console.error("[sufra] write failed:", err.message);
    return false;
  }
  memory.set(key, raw);
  return true;
}

export async function del(key) {
  warnOnce();
  try {
    if (backend === "tcp") {
      const client = await tcpClient();
      if (client) {
        await client.del(key);
        return true;
      }
    } else if (backend === "http") {
      await rest(["DEL", key]);
      return true;
    }
  } catch (err) {
    console.error("[sufra] delete failed:", err.message);
    return false;
  }
  memory.delete(key);
  return true;
}

/* Test seam. */
export function __resetMemory() {
  memory.clear();
  warned = false;
  clientPromise = null;
}
