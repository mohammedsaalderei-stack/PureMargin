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

async function readBody(req) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) return null;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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
  req.body = await readBody(rawReq);
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
