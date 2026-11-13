/* LanBridgeAdapter: a network printer, from a web page.

   Safari cannot open a socket, so the bytes go the long way round: to
   PureMargin's print queue (`/api/print`), from where a small program inside
   the shop — the print bridge — collects them and writes them to the printer.
   No print dialog; the receipt simply comes out.

   Sending a job and its being printed are two events, and this adapter does
   not confuse them. It queues the job, then waits to be told what the bridge
   found: printed, or exactly why not. A job the queue accepted and nobody
   printed is a failure here, not a success.

   It needs the internet, which a direct connection does not: with the
   connection down the till still sells, and this path cannot print. The
   error says that in so many words. */

import { toBase64 } from "../escpos.js";
import { PrintError } from "../PrintJobManager.js";

/* Long enough for a job to be collected and printed, or to be given up on by
   the queue itself — whichever the queue says first. */
const GIVE_UP_MS = 170 * 1000;

export function createLanBridgeAdapter({ auth, fetchImpl = (...a) => globalThis.fetch(...a), wait = 8, now = () => Date.now() }) {
  async function call(method, what, { query = {}, body = null } = {}) {
    const who = auth?.() || {};
    if (!who.token) throw new PrintError("signin");
    const qs = new URLSearchParams({ what, ...query }).toString();
    let res;
    try {
      res = await fetchImpl(`/api/print?${qs}`, {
        method,
        headers: {
          Authorization: `Bearer ${who.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(who.operator ? { "x-register-operator": who.operator } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new PrintError("nonetwork");
    }
    const json = await res.json().catch(() => null);
    /* A page of HTML — a Wi-Fi sign-in, a proxy — is the network, not the queue. */
    if (json === null || typeof json !== "object") throw new PrintError("nonetwork");
    if (!res.ok) throw new PrintError(json.error || (res.status === 401 ? "signin" : "server"), "", { status: res.status, body: json });
    return json;
  }

  /* Wait for a job to end. */
  async function outcome(id) {
    const deadline = now() + GIVE_UP_MS;
    for (;;) {
      const { job } = await call("GET", "job", { query: { id, wait: String(wait) } });
      if (job.state === "printed") return job;
      if (job.state === "failed") throw new PrintError(job.error || "failed", "", { printer: job.printer });
      if (now() > deadline) throw new PrintError("unconfirmed");
    }
  }

  const address = (printer) => ({ host: String(printer.host || "").trim(), port: Number(printer.port) || 9100 });

  return {
    id: "lan-bridge",
    capabilities: () => ({ raw: true, drawer: true, cut: true, silent: true, reports: true }),

    async send(printer, { id, kind, bytes, retry = false, status = true }) {
      await call("POST", "job", { body: { id, ...address(printer), data: toBase64(bytes), label: kind, retry, status } });
      const job = await outcome(id);
      return { state: job.confirmed ? "printed" : "sent", confirmed: job.confirmed, printer: job.printer };
    },

    /* Can the bridge reach the printer, and what does the printer say? */
    async probe(printer) {
      const id = `probe-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await call("POST", "probe", { body: { id, ...address(printer) } });
      const job = await outcome(id);
      return { reachable: true, printer: job.printer, ms: job.ms };
    },

    /* Tell the queue this printer may be printed to. Needs settings rights:
       which addresses the bridge will write to is not a cashier's to decide. */
    register: (printer, bridgeId) => call("PUT", "target", { body: { ...address(printer), name: printer.name || "", ...(bridgeId ? { bridgeId } : {}) } }),
    setup: () => call("GET", "setup"),
    addBridge: (name) => call("POST", "bridge", { body: { name } }),
    removeBridge: (id) => call("DELETE", "bridge", { query: { id } }),
    removeTarget: (host, port) => call("DELETE", "target", { query: { host, port: String(port) } }),
  };
}
