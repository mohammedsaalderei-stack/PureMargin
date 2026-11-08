/* The printers this device prints to, and how a job reaches each one.

   Printers belong to the device, not the business: the iPad at the counter
   prints to the receipt printer beside it, the one at the pass to the
   kitchen. So the list lives in this device's storage, never on the server.

   ── How a job gets to a printer ──────────────────────────────────────────

   network   A receipt printer on the Wi-Fi or a cable, at an IP address, port
             9100 — the raw socket every Epson, Star, Bixolon and Xprinter
             listens on. Only the app can open one: a web page is not allowed
             a raw socket, so on the website this connection is unavailable.
   airprint  The iPhone's or iPad's own printing (AirPrint). Any printer iOS
             can see, including office printers, prints the receipt picture.
   usb       A printer plugged into a computer, from Chrome or Edge on the
             website (WebUSB). Windows needs the WinUSB driver for it.
   serial    The same over a serial or USB-serial port (Web Serial).
   bluetooth Bluetooth printers. In the app: Bluetooth LE printers (most
             portable and budget ones) found by scanning, and Epson or Star
             printers paired in iPhone Settings (MFi). On the website: Chrome
             or Edge on Android or a computer, LE printers only (Web
             Bluetooth); Safari has no Bluetooth at all.
   browser   The browser's own print dialog — always available, and the
             answer for any printer the computer already has installed.

   A cash drawer plugs into the receipt printer, so it opens through the
   printer on network, usb, serial and bluetooth connections. */

import { registerPlugin, Capacitor } from "@capacitor/core";
import { job, drawerOnly, toBase64, dotsFor } from "./escpos.js";
import { drawReceipt, drawKitchen, drawShift, drawTest } from "./render.js";

const KEY = "pm_printers";
const NativePrinter = registerPlugin("Printer");
const native = () => Capacitor.isNativePlatform?.() && Capacitor.isPluginAvailable?.("Printer");

export function connectionsAvailable() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  return {
    network: Boolean(native()),
    airprint: Boolean(native()),
    usb: !native() && Boolean(nav.usb),
    serial: !native() && Boolean(nav.serial),
    bluetooth: Boolean(native()) || Boolean(nav.bluetooth),
    browser: !native(),
  };
}

export function loadPrinters() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function savePrinters(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
  return list;
}

export function newPrinter(over = {}) {
  return {
    id: `pr${Date.now().toString(36)}`,
    name: "",
    connection: connectionsAvailable().network ? "network" : "browser",
    host: "",
    port: 9100,
    paper: 80,
    role: "receipt",
    categories: [],
    autoPrint: true,
    drawer: true,
    copies: 1,
    ...over,
  };
}

/* Network printers this device can see, from their Bonjour announcements. */
export async function discover() {
  if (!native()) return [];
  try {
    const out = await NativePrinter.discover({ timeout: 3000 });
    return out?.printers || [];
  } catch {
    return [];
  }
}

/* Bluetooth printers in reach, in the app: LE printers advertising nearby
   and Epson/Star printers paired with this device. */
export async function discoverBluetooth() {
  if (!native()) return [];
  const out = await NativePrinter.bluetoothScan({ timeout: 4000 });
  return out?.printers || [];
}

/* iOS's own picker for an Epson or Star Bluetooth printer not paired yet. */
export async function pickBluetoothAccessory() {
  if (!native()) return [];
  const out = await NativePrinter.pickAccessory();
  return out?.printers || [];
}

/* ── Transports ── */

async function sendNetwork(printer, bytes) {
  if (!native()) throw new Error("network-needs-app");
  await NativePrinter.send({
    host: printer.service ? undefined : printer.host,
    port: Number(printer.port) || 9100,
    service: printer.service || undefined,
    data: toBase64(bytes),
  });
}

async function usbDevice(printer, ask) {
  const known = await navigator.usb.getDevices();
  let device = known.find((d) => d.vendorId === printer.vendorId && d.productId === printer.productId);
  if (!device && ask) device = await navigator.usb.requestDevice({ filters: [] });
  if (!device) throw new Error("usb-not-paired");
  return device;
}

async function sendUsb(printer, bytes) {
  const device = await usbDevice(printer, false);
  if (!device.opened) await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((i) =>
    i.alternate.endpoints.some((e) => e.direction === "out")) || device.configuration.interfaces[0];
  if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
  const endpoint = iface.alternate.endpoints.find((e) => e.direction === "out");
  for (let i = 0; i < bytes.length; i += 16384) {
    await device.transferOut(endpoint.endpointNumber, bytes.subarray(i, i + 16384));
  }
}

/* The GATT services Web Bluetooth may open, which it must be told up front:
   the 18F0 service most budget printers share, the Feasycom and Microchip
   serial bridges, and the FFxx serial profiles. */
const BLE_SERVICES = [
  0x18f0, "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  0xff00, 0xffe0, 0xfff0,
];
const webDevices = new Map();

async function webBluetoothDevice(printer) {
  if (webDevices.has(printer.btId)) return webDevices.get(printer.btId);
  const known = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
  const device = known.find((d) => d.id === printer.btId);
  if (!device) throw new Error("bluetooth-not-paired");
  webDevices.set(device.id, device);
  return device;
}

async function sendWebBluetooth(printer, bytes) {
  const device = await webBluetoothDevice(printer);
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  let target = null;
  for (const service of await server.getPrimaryServices()) {
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) { target = ch; break; }
    }
    if (target) break;
  }
  if (!target) throw new Error("bluetooth-not-a-printer");
  const fast = target.properties.writeWithoutResponse;
  for (let i = 0; i < bytes.length; i += 180) {
    const chunk = bytes.subarray(i, i + 180);
    if (fast) await target.writeValueWithoutResponse(chunk);
    else await target.writeValueWithResponse(chunk);
  }
}

async function sendBluetooth(printer, bytes) {
  if (native()) {
    await NativePrinter.bluetoothSend({ id: printer.btId, kind: printer.btKind || "ble", protocol: printer.btProtocol || undefined, data: toBase64(bytes) });
    return;
  }
  await sendWebBluetooth(printer, bytes);
}

/* One way out for raw bytes, whichever connection the printer is on. */
async function sendRaw(printer, bytes) {
  if (printer.connection === "network") await sendNetwork(printer, bytes);
  else if (printer.connection === "usb") await sendUsb(printer, bytes);
  else if (printer.connection === "serial") await sendSerial(printer, bytes);
  else if (printer.connection === "bluetooth") await sendBluetooth(printer, bytes);
  else throw new Error("no-raw-connection");
}

async function sendSerial(printer, bytes) {
  const ports = await navigator.serial.getPorts();
  const port = ports[printer.portIndex || 0];
  if (!port) throw new Error("serial-not-paired");
  if (!port.writable) await port.open({ baudRate: Number(printer.baud) || 9600 });
  const writer = port.writable.getWriter();
  try { await writer.write(bytes); } finally { writer.releaseLock(); }
}

/* Ask the browser for a USB or serial printer. Has to run inside a click. */
export async function pairDevice(printer) {
  if (printer.connection === "usb") {
    const device = await usbDevice(printer, true);
    return { ...printer, vendorId: device.vendorId, productId: device.productId, name: printer.name || device.productName || "USB printer" };
  }
  if (printer.connection === "serial") {
    const port = await navigator.serial.requestPort();
    const ports = await navigator.serial.getPorts();
    return { ...printer, portIndex: Math.max(0, ports.indexOf(port)) };
  }
  if (printer.connection === "bluetooth" && !native()) {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    webDevices.set(device.id, device);
    return { ...printer, btId: device.id, btKind: "ble", btName: device.name || "", name: printer.name || device.name || "Bluetooth printer" };
  }
  return printer;
}

function printPicture(canvas, paper) {
  const url = canvas.toDataURL("image/png");
  if (native()) return NativePrinter.airPrint({ image: url.split(",")[1], jobName: "Receipt" });
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><style>@page{size:${paper}mm auto;margin:0}body{margin:0}img{width:${paper}mm;display:block}</style></head><body><img src="${url}"></body></html>`);
    doc.close();
    const img = doc.querySelector("img");
    const go = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => { frame.remove(); resolve(); }, 1000);
    };
    if (img.complete) go(); else img.onload = go;
  });
}

async function deliver(printer, canvas, { drawer = false } = {}) {
  const copies = Math.max(1, Math.min(3, Number(printer.copies) || 1));
  if (printer.connection === "airprint" || printer.connection === "browser") {
    await printPicture(canvas, printer.paper || 80);
    return;
  }
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let c = 0; c < copies; c += 1) {
    const bytes = job(imageData, { drawer: drawer && c === 0 && printer.drawer });
    await sendRaw(printer, bytes);
  }
}

/* ── What the register asks for ── */

const widthOf = (printer) => dotsFor(printer.paper);

export async function printReceipt(receipt, ctx, { openDrawer = false, copy = false } = {}) {
  const printers = loadPrinters().filter((p) => p.role === "receipt");
  const results = [];
  for (const printer of printers) {
    try {
      const canvas = drawReceipt(receipt, { ...ctx, copy, width: widthOf(printer) });
      await deliver(printer, canvas, { drawer: openDrawer });
      results.push({ id: printer.id, ok: true });
    } catch (err) {
      results.push({ id: printer.id, ok: false, error: String(err?.message || err) });
    }
  }
  return results;
}

/* An order to each kitchen printer, with only the lines it makes. A printer
   with no categories set takes everything. */
export async function printKitchen(order, ctx, { added = false } = {}) {
  const printers = loadPrinters().filter((p) => p.role === "kitchen");
  const results = [];
  for (const printer of printers) {
    const lines = printer.categories?.length
      ? order.lines.filter((l) => printer.categories.includes(l.category))
      : order.lines;
    if (!lines.length) continue;
    try {
      const canvas = drawKitchen({ ...order, lines }, { ...ctx, added, width: widthOf(printer) });
      await deliver(printer, canvas);
      results.push({ id: printer.id, ok: true });
    } catch (err) {
      results.push({ id: printer.id, ok: false, error: String(err?.message || err) });
    }
  }
  return results;
}

export async function printShift(shift, summary, ctx) {
  const printer = loadPrinters().find((p) => p.role === "receipt");
  if (!printer) return [{ ok: false, error: "no-printer" }];
  try {
    await deliver(printer, drawShift(shift, summary, { ...ctx, width: widthOf(printer) }));
    return [{ id: printer.id, ok: true }];
  } catch (err) {
    return [{ id: printer.id, ok: false, error: String(err?.message || err) }];
  }
}

export async function testPrint(printer, ctx) {
  await deliver(printer, drawTest(printer, { ...ctx, width: widthOf(printer) }), { drawer: false });
}

/* The drawer on its own — "no sale". */
export async function openDrawer() {
  const printer = loadPrinters().find((p) => p.role === "receipt" && p.drawer && ["network", "usb", "serial", "bluetooth"].includes(p.connection));
  if (!printer) throw new Error("no-drawer");
  await sendRaw(printer, drawerOnly());
}
