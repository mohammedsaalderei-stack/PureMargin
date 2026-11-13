/* Printing to a printer on the shop's network, from a browser (`_printqueue.js`).

   Two kinds of caller, told apart by the token they carry:

   The till, signed in as a person or as a register-only device
     GET    ?what=setup                 bridges, whether each answers, registered printers
     GET    ?what=job&id=&wait=         what became of a job; waits up to `wait` seconds for an ending
     POST   ?what=job                   { id, host, port, data, label, retry } → queued, or the earlier job
     POST   ?what=probe                 { id, host, port } → a connection test, read like a job
     POST   ?what=bridge  { name }      → a bridge and its token, shown once          (settings rights)
     DELETE ?what=bridge&id=                                                          (settings rights)
     PUT    ?what=target  { host, port, name, bridgeId }                              (settings rights)
     DELETE ?what=target&host=&port=                                                  (settings rights)

   The print bridge, with the token it was given (`B.…`)
     GET    ?what=hello                 who it is signed in as
     GET    ?what=claim&wait=           its queued jobs; waits up to `wait` seconds for one
     POST   ?what=done                  { id, ok, error, wrote, printer, ms }

   "Settings rights" is what the register's own settings need: `manage:costs`,
   or on a staff device a manager's PIN. Selling is enough to print. */

import { requireAuth } from "./_auth.js";
import { handledUnavailable } from "./_store.js";
import { scopeFor } from "./_org.js";
import { rosterFor } from "./_till.js";
import { readOperator } from "./_tillstaff.js";
import { recordAudit } from "./_audit.js";
import {
  enqueue, getJob, publicJob, claim, report, mayHaveWork, printSetup,
  createBridge, removeBridge, addTarget, removeTarget, readBridgeToken, touchBridge,
  readTarget, listTargets, targetKeyOf,
} from "./_printqueue.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT = 25;
const waitOf = (req, fallback) => Math.max(0, Math.min(MAX_WAIT, Number(req.query?.wait ?? fallback) || 0)) * 1000;

async function bridgeSide(req, res, token) {
  const who = await readBridgeToken(token);
  if (!who) return res.status(401).json({ error: "bridgetoken" });
  const { orgId, bridge } = who;
  const what = String(req.query?.what || "");
  const now = Date.now();
  const meta = { now, version: String(req.headers["x-bridge-version"] || ""), machine: String(req.headers["x-bridge-machine"] || "") };

  if (req.method === "GET" && what === "hello") {
    await touchBridge(orgId, bridge.id, meta);
    return res.status(200).json({ ok: true, bridge: { id: bridge.id, name: bridge.name } });
  }

  if (req.method === "GET" && what === "claim") {
    await touchBridge(orgId, bridge.id, meta);
    const until = now + waitOf(req, 0);
    for (;;) {
      if (await mayHaveWork(orgId)) {
        const jobs = await claim(orgId, bridge.id);
        if (jobs.length) return res.status(200).json({ jobs });
      }
      if (Date.now() + 1000 > until) return res.status(200).json({ jobs: [] });
      await sleep(1000);
    }
  }

  if (req.method === "POST" && what === "done") {
    const out = await report(orgId, bridge.id, req.body || {});
    if (out.error) return res.status(out.error === "forbidden" ? 403 : 404).json(out);
    return res.status(200).json({ ok: true, state: out.job.state });
  }

  return res.status(400).json({ error: "what" });
}

export default async function handler(req, res) {
  try {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (bearer.startsWith("B.")) return await bridgeSide(req, res, bearer);

    const session = await requireAuth(req, res);
    if (!session) return undefined;

    let roster = [];
    try { roster = await rosterFor(session.account); } catch { roster = []; }
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });
    if (!scope.capabilities.includes("use:till")) return res.status(403).json({ error: "forbidden" });

    const what = String(req.query?.what || (req.method === "GET" ? "setup" : ""));
    const body = req.body || {};
    const now = Date.now();
    const operator = readOperator(req.headers?.["x-register-operator"], orgId, now);
    const mayManage = session.registerOnly ? operator?.role === "manager" : scope.capabilities.includes("manage:costs");
    const actor = operator ? `${operator.name} (${session.username})` : session.username;
    const refuse = () => res.status(403).json({ error: "forbidden" });

    if (req.method === "GET" && what === "setup") {
      return res.status(200).json({ ...(await printSetup(orgId, now)), canManage: Boolean(mayManage) });
    }

    if (req.method === "GET" && what === "job") {
      const until = now + waitOf(req, 0);
      for (;;) {
        const job = await getJob(orgId, req.query?.id);
        if (!job) return res.status(404).json({ error: "notfound" });
        if (job.state === "printed" || job.state === "failed" || Date.now() + 500 > until) return res.status(200).json({ job: publicJob(job) });
        await sleep(500);
      }
    }

    if (req.method === "POST" && (what === "job" || what === "probe")) {
      const out = await enqueue(orgId, { ...body, kind: what === "probe" ? "probe" : "print" }, { by: actor, now });
      if (out.error) {
        const status = { notarget: 422, nobridge: 409, bridgeoffline: 503, id: 400, host: 400, port: 400, data: 413 }[out.error] || 400;
        return res.status(status).json(out);
      }
      return res.status(200).json({ job: publicJob(out.job), duplicate: Boolean(out.duplicate) });
    }

    if (req.method === "POST" && what === "bridge") {
      if (!mayManage) return refuse();
      const out = await createBridge(orgId, { name: body.name, by: actor, now });
      if (out.error) return res.status(422).json(out);
      await recordAudit(orgId, { actor, action: "print.bridge.add", target: out.bridge.name, detail: { id: out.bridge.id } });
      return res.status(200).json({ bridge: { id: out.bridge.id, name: out.bridge.name }, token: out.token });
    }

    if (req.method === "DELETE" && what === "bridge") {
      if (!mayManage) return refuse();
      const out = await removeBridge(orgId, String(req.query?.id || ""));
      if (out.error) return res.status(404).json(out);
      await recordAudit(orgId, { actor, action: "print.bridge.remove", detail: { id: String(req.query?.id || "") } });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "PUT" && what === "target") {
      /* A printer a manager has already registered is every till's to use:
         a second till setting itself up to print there changes nothing and
         needs nobody's permission. A new address does. */
      const wanted = readTarget(body);
      if (wanted.error) return res.status(422).json(wanted);
      const known = (await listTargets(orgId)).find((t) => targetKeyOf(t.host, t.port) === targetKeyOf(wanted.host, wanted.port));
      if (known && (!mayManage || !body.bridgeId || body.bridgeId === known.bridgeId)) {
        return res.status(200).json({ target: { host: known.host, port: known.port, bridgeId: known.bridgeId } });
      }
      if (!mayManage) return refuse();
      const out = await addTarget(orgId, body, { by: actor, now });
      if (out.error) return res.status(out.error === "nobridge" ? 409 : 422).json(out);
      if (out.added) await recordAudit(orgId, { actor, action: "print.target.add", target: `${out.target.host}:${out.target.port}`, detail: { name: out.target.name } });
      return res.status(200).json({ target: { host: out.target.host, port: out.target.port, bridgeId: out.target.bridgeId } });
    }

    if (req.method === "DELETE" && what === "target") {
      if (!mayManage) return refuse();
      const out = await removeTarget(orgId, String(req.query?.host || ""), Number(req.query?.port));
      if (out.error) return res.status(404).json(out);
      await recordAudit(orgId, { actor, action: "print.target.remove", target: `${req.query?.host}:${req.query?.port}` });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "what" });
  } catch (err) {
    if (handledUnavailable(res, err)) return undefined;
    console.error("print route failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
