/* Dev-only API server.
   The /api/*.js files are Vercel serverless functions exporting
   `export default async function handler(req, res)`. This mounts them all
   under /api on a plain Node http server so the app runs outside Vercel.
   The Vite dev server proxies /api here (see vite.config.js). */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.API_PORT) || 3001;
const here = path.dirname(fileURLToPath(import.meta.url));

// Discover handlers: api/<name>.js (skip _-prefixed helpers).
const handlers = {};
for (const file of fs.readdirSync(path.join(here, "api"))) {
  if (file.startsWith("_") || !file.endsWith(".js")) continue;
  const name = file.slice(0, -3);
  const mod = await import(`./api/${file}`);
  if (typeof mod.default === "function") handlers[name] = mod.default;
}

function decorateRes(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (obj) {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

/* Returns the parsed body and keeps the exact bytes it came from.

   The raw text matters for webhooks. A signature is an HMAC over what the
   sender transmitted, and re-serialising the parsed object does not reproduce
   it — key order, spacing and number formatting are all free to differ, so the
   digest would never match and a correctly signed request would be refused.
   The caller reads it from `req.rawBody`. */
async function readBody(req) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) return { body: null, raw: "" };
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return { body: null, raw: "" };
  try {
    return { body: JSON.parse(raw), raw };
  } catch {
    return { body: null, raw };
  }
}

const server = http.createServer(async (rawReq, rawRes) => {
  const url = new URL(rawReq.url, `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/api\/([a-z0-9_-]+)$/);
  if (!match) {
    rawRes.statusCode = 404;
    return rawRes.end("Not found");
  }
  const handler = handlers[match[1]];
  if (!handler) {
    rawRes.statusCode = 404;
    return rawRes.end("Not found");
  }

  const req = rawReq;
  const read = await readBody(rawReq);
  req.body = read.body;
  /* The bytes as sent, for anything verifying a signature over them. */
  req.rawBody = read.raw;
  req.query = Object.fromEntries(url.searchParams);
  const res = decorateRes(rawRes);

  try {
    await handler(req, res);
  } catch (err) {
    console.error(`[api/${match[1]}] failed:`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "server" }));
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[sufra] API server listening on 0.0.0.0:${PORT}`);
  console.log(`[sufra] routes: ${Object.keys(handlers).sort().join(", ")}`);
});
