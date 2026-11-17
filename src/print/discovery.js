/* What "Find printers" lists in the app.

   Receipt printers come in two kinds, so two searches run side by side.

   Some announce themselves on the network (Bonjour, `_pdl-datastream._tcp`)
   and arrive with a model name. Most counter printers — iCE, Xprinter,
   Rongta and the many sold under other names — announce nothing at all, and
   their settings page has no switch to make them. The only sign of one is
   port 9100 open, so the app also tries that port on every address of the
   Wi-Fi it is on (`scan` in `ios/App/App/PrinterPlugin.swift`). The iCE
   IRP-200D at the shop is the second kind: before the sweep, the search
   found nothing while the printer sat at 192.168.8.19 answering.

   This joins the two into one list — named printers first, then the ones
   found by address, in address order, each address once. Pure, so it is
   tested without a phone (`discovery.test.mjs`). */

/* An IPv4 address as one number, so .2 sorts before .19 before .100, or
   null when it is not one. */
export function ipv4Number(host) {
  const parts = typeof host === "string" ? host.trim().split(".") : [];
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
}

export function mergeFound(named, scanned) {
  const out = [];

  const services = new Set();
  for (const f of Array.isArray(named) ? named : []) {
    if (!f?.service || services.has(f.service)) continue;
    services.add(f.service);
    out.push({ name: f.name || f.service, service: f.service });
  }

  const seen = new Set();
  const byAddress = [];
  for (const f of Array.isArray(scanned) ? scanned : []) {
    const host = typeof f?.host === "string" ? f.host.trim() : "";
    const order = ipv4Number(host);
    if (order === null) continue;
    const port = Number(f.port) || 9100;
    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    /* The port is part of the name only when it is not the usual one. */
    byAddress.push({ name: port === 9100 ? host : key, host, port, order });
  }
  byAddress.sort((a, b) => a.order - b.order || a.port - b.port);
  for (const { order, ...f } of byAddress) out.push(f);

  return out;
}

/* What a found printer is listed under, and whether it is the one the form
   already holds. A printer picked by name is not also "chosen" by address:
   the form keeps one or the other, never both. */
export const foundKey = (f) => (f.service ? `svc:${f.service}` : `ip:${f.host}:${f.port}`);

export function isChosen(p, f) {
  if (f.service) return p.service === f.service;
  return !p.service && String(p.host || "").trim() === f.host && (Number(p.port) || 9100) === f.port;
}

/* What the form takes from a found printer. Picked by name: the name it
   announced, if the printer has none yet. Picked by address: the address and
   port, and no name — an IP address is not a name, and the list already
   prints it beside "Unnamed". */
export function chooseFound(p, f) {
  if (f.service) return { service: f.service, host: "", name: p.name || f.name };
  return { service: "", host: f.host, port: f.port };
}
