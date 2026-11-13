/* The register's printing, wired for this device.

   Everything the screens import comes from here. What is behind it:
   `PrinterService.js` (which printers, what goes to each), `PrintJobManager.js`
   (one job format, per-printer outcomes, no double prints) and the adapters
   in `adapters/` (how bytes leave the device). This file only decides which
   adapter a printer gets — the one thing that depends on where the register
   is running:

     network    the app → NativePrintAdapter (a socket, directly)
                a browser → LanBridgeAdapter (the queue and the bridge)
     airprint   NativePrintAdapter
     bluetooth  the app → NativePrintAdapter, a browser → WebDeviceAdapter
     usb, serial  WebDeviceAdapter
     browser    BrowserPrintAdapter

   So a network printer is set up once, with the same fields, and prints from
   Safari and from the app; only the way there differs. */

import { createPrinterService } from "./PrinterService.js";
import { createBrowserPrintAdapter } from "./adapters/BrowserPrintAdapter.js";
import { createLanBridgeAdapter } from "./adapters/LanBridgeAdapter.js";
import { createNativePrintAdapter, nativeAvailable } from "./adapters/NativePrintAdapter.js";
import { createWebDeviceAdapter } from "./adapters/WebDeviceAdapter.js";
import { drawReceipt, drawKitchen, drawShift, drawTest } from "./render.js";

export { PROFILES, profileOf } from "./profiles.js";
export { printerKey, kitchenWork, applyKitchenResults } from "./kitchen.js";

/* Who is signed in, for the adapter that goes through the server. Set by the
   register as it opens; a function, so it is always the current session. */
let session = () => ({});
export const setPrintSession = (fn) => { session = typeof fn === "function" ? fn : () => ({}); };

const browser = createBrowserPrintAdapter();
const lan = createLanBridgeAdapter({ auth: () => session() });
const native = createNativePrintAdapter();
const device = createWebDeviceAdapter();

export function connectionsAvailable() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const app = nativeAvailable();
  return {
    network: true,
    airprint: app,
    usb: !app && Boolean(nav.usb),
    serial: !app && Boolean(nav.serial),
    bluetooth: app || Boolean(nav.bluetooth),
    browser: !app,
  };
}

function adapterFor(printer) {
  const app = nativeAvailable();
  switch (printer?.connection) {
    case "network": return app ? native : lan;
    case "airprint": return app ? native : null;
    case "bluetooth": return app ? native : device;
    case "usb":
    case "serial": return app ? null : device;
    case "browser": return app ? null : browser;
    default: return null;
  }
}

const service = createPrinterService({
  storage: () => localStorage,
  adapterFor,
  connections: connectionsAvailable,
  draw: { receipt: drawReceipt, kitchen: drawKitchen, shift: drawShift, test: drawTest },
});

/* One name per line, not a destructuring: `scripts/check-imports` reads
   exports as written, and so does a person looking for one. */
export const loadPrinters = service.loadPrinters;
export const savePrinters = service.savePrinters;
export const newPrinter = service.newPrinter;
export const capabilitiesOf = service.capabilitiesOf;
export const prepare = service.prepare;
export const checkPrinter = service.checkPrinter;
export const printReceipt = service.printReceipt;
export const printKitchen = service.printKitchen;
export const settleKitchen = service.settleKitchen;
export const printShift = service.printShift;
export const testPrint = service.testPrint;
export const openDrawer = service.openDrawer;
export const printerStatus = service.statusOf;
export const onPrinterStatus = service.subscribe;

/* The print bridge's own settings: which bridges exist, whether they answer. */
export const printBridge = lan;
/* True where a network printer is reached through the bridge, not directly. */
export const usesBridge = () => !nativeAvailable();

export const discover = () => (nativeAvailable() ? native.discover() : Promise.resolve([]));
export const discoverBluetooth = () => (nativeAvailable() ? native.discoverBluetooth() : Promise.resolve([]));
export const pickBluetoothAccessory = () => (nativeAvailable() ? native.pickBluetoothAccessory() : Promise.resolve([]));
export const pairDevice = (printer) => (nativeAvailable() ? Promise.resolve(printer) : device.pair(printer));
