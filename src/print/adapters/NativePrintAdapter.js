/* NativePrintAdapter: printing from the app (Capacitor).

   The app can do what a browser cannot — open a socket to a printer on the
   network, talk to a Bluetooth one, hand a picture to AirPrint — through the
   `Printer` plugin (`ios/App/App/PrinterPlugin.swift`). Same jobs, same
   settings, same screen as the website; only this file is different. A
   network printer set up in Safari, which prints there through the bridge,
   prints from the app directly, with no bridge and no internet.

   The plugin writes bytes and reports whether the write went through. It does
   not ask the printer whether it has paper, so a network or Bluetooth job
   from the app ends as "sent", never as confirmed by the printer. */

import { registerPlugin, Capacitor } from "@capacitor/core";
import { toBase64, INIT } from "../escpos.js";
import { PrintError } from "../PrintJobManager.js";

const NativePrinter = registerPlugin("Printer");
export const nativeAvailable = () => Boolean(Capacitor.isNativePlatform?.() && Capacitor.isPluginAvailable?.("Printer"));

const fail = (err, fallback = "unreachable") => {
  const text = String(err?.message || err || "");
  if (/did not answer|timed out|unreachable|No route/i.test(text)) return new PrintError("unreachable", text);
  if (/refused/i.test(text)) return new PrintError("refused", text);
  return new PrintError(fallback, text);
};

export function createNativePrintAdapter({ plugin = NativePrinter } = {}) {
  const network = (printer, bytes) => plugin.send({
    host: printer.service ? undefined : printer.host,
    port: Number(printer.port) || 9100,
    service: printer.service || undefined,
    data: toBase64(bytes),
  });

  return {
    id: "native",
    capabilities: (printer) => (printer.connection === "airprint"
      ? { raw: false, drawer: false, cut: false, silent: false, reports: false }
      : { raw: true, drawer: true, cut: true, silent: true, reports: false }),

    async send(printer, { bytes, pictures }) {
      try {
        if (printer.connection === "airprint") {
          for (const url of pictures) await plugin.airPrint({ image: url.split(",")[1], jobName: "Receipt" });
          return { state: "dialog", confirmed: false };
        }
        if (printer.connection === "bluetooth") {
          await plugin.bluetoothSend({ id: printer.btId, kind: printer.btKind || "ble", protocol: printer.btProtocol || undefined, data: toBase64(bytes) });
          return { state: "sent", confirmed: false };
        }
        await network(printer, bytes);
        return { state: "sent", confirmed: false };
      } catch (err) {
        throw fail(err, printer.connection === "bluetooth" ? "bluetooth" : "unreachable");
      }
    },

    /* Reachable? Opens the connection and sends a reset, which prints nothing. */
    async probe(printer) {
      if (printer.connection !== "network") throw new PrintError("noprobe");
      try { await network(printer, Uint8Array.from(INIT)); } catch (err) { throw fail(err); }
      return { reachable: true, printer: null };
    },

    discover: async () => {
      try { return (await plugin.discover({ timeout: 3000 }))?.printers || []; } catch { return []; }
    },
    discoverBluetooth: async () => (await plugin.bluetoothScan({ timeout: 4000 }))?.printers || [],
    pickBluetoothAccessory: async () => (await plugin.pickAccessory())?.printers || [],
  };
}
