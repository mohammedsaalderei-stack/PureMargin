/* WebDeviceAdapter: a printer plugged into, or paired with, this computer.

   WebUSB, Web Serial and Web Bluetooth — Chrome and Edge, not Safari. Raw
   bytes straight to the device, so the drawer and the cutter work. The write
   either completes or throws; the printer is not asked how it is. */

import { PrintError } from "../PrintJobManager.js";

/* The GATT services Web Bluetooth may open, which it must be told up front:
   the 18F0 service most budget printers share, the Feasycom and Microchip
   serial bridges, and the FFxx serial profiles. */
const BLE_SERVICES = [
  0x18f0, "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  0xff00, 0xffe0, 0xfff0,
];
const webDevices = new Map();

async function usbDevice(printer, ask) {
  const known = await navigator.usb.getDevices();
  let device = known.find((d) => d.vendorId === printer.vendorId && d.productId === printer.productId);
  if (!device && ask) device = await navigator.usb.requestDevice({ filters: [] });
  if (!device) throw new PrintError("usb-not-paired");
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

async function sendSerial(printer, bytes) {
  const ports = await navigator.serial.getPorts();
  const port = ports[printer.portIndex || 0];
  if (!port) throw new PrintError("serial-not-paired");
  if (!port.writable) await port.open({ baudRate: Number(printer.baud) || 9600 });
  const writer = port.writable.getWriter();
  try { await writer.write(bytes); } finally { writer.releaseLock(); }
}

async function webBluetoothDevice(printer) {
  if (webDevices.has(printer.btId)) return webDevices.get(printer.btId);
  const known = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
  const device = known.find((d) => d.id === printer.btId);
  if (!device) throw new PrintError("bluetooth-not-paired");
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
  if (!target) throw new PrintError("bluetooth-not-a-printer");
  const fast = target.properties.writeWithoutResponse;
  for (let i = 0; i < bytes.length; i += 180) {
    const chunk = bytes.subarray(i, i + 180);
    if (fast) await target.writeValueWithoutResponse(chunk);
    else await target.writeValueWithResponse(chunk);
  }
}

export function createWebDeviceAdapter() {
  return {
    id: "web-device",
    capabilities: () => ({ raw: true, drawer: true, cut: true, silent: true, reports: false }),

    async send(printer, { bytes }) {
      try {
        if (printer.connection === "usb") await sendUsb(printer, bytes);
        else if (printer.connection === "serial") await sendSerial(printer, bytes);
        else await sendWebBluetooth(printer, bytes);
      } catch (err) {
        if (err instanceof PrintError) throw err;
        throw new PrintError("device", String(err?.message || err));
      }
      return { state: "sent", confirmed: false };
    },

    /* Ask the browser for the printer. Has to run inside a click. */
    async pair(printer) {
      if (printer.connection === "usb") {
        const device = await usbDevice(printer, true);
        return { ...printer, vendorId: device.vendorId, productId: device.productId, name: printer.name || device.productName || "USB printer" };
      }
      if (printer.connection === "serial") {
        const port = await navigator.serial.requestPort();
        const ports = await navigator.serial.getPorts();
        return { ...printer, portIndex: Math.max(0, ports.indexOf(port)) };
      }
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      webDevices.set(device.id, device);
      return { ...printer, btId: device.id, btKind: "ble", btName: device.name || "", name: printer.name || device.name || "Bluetooth printer" };
    },
  };
}
