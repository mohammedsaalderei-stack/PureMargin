/* ESC/POS: the language receipt printers speak.

   Almost every thermal receipt printer behind a counter — Epson TM, Star,
   Bixolon, Xprinter, Sunmi and the unbranded ones — understands this command
   set over a network socket, USB or serial. Only a handful of its commands
   are needed here.

   ── Why the receipt is sent as a picture ─────────────────────────────────

   A printer's own fonts are a code page: a fixed table of characters, almost
   never including Arabic, and never shaping it — the letters of a word change
   form depending on their neighbours, and right-to-left lines have to be laid
   out as such. Printing a receipt in Arabic as text produces either question
   marks or disconnected letters in the wrong order. So the receipt is drawn
   on a canvas by the same engine that draws the screen, and the printer is
   sent the dots. It prints exactly what the screen shows, in any language,
   on any ESC/POS printer that supports raster images, which is all of the
   current ones. */

export const INIT = [0x1b, 0x40];
/* Feed a few lines so the cut falls below the last line, then cut: partial
   leaves a tab so the receipt hangs until it is taken, full does not. A
   printer with a tear bar and no cutter is only fed. */
export const FEED = [0x1b, 0x64, 0x04];
export const CUTS = { partial: [0x1d, 0x56, 0x42, 0x00], full: [0x1d, 0x56, 0x41, 0x00] };
export const FEED_AND_CUT = [...FEED, ...CUTS.partial];
/* Pulse the cash drawer for 50 ms on, 500 ms off — pin 2, or pin 5 for the
   second drawer. The drawer plugs into the printer, not the device, so this
   is how a till opens it. */
export const OPEN_DRAWER = [0x1b, 0x70, 0x00, 0x19, 0xfa];
export const drawerPulse = (pin = 2) => [0x1b, 0x70, Number(pin) === 5 ? 0x01 : 0x00, 0x19, 0xfa];
export const BEEP = [0x1b, 0x42, 0x02, 0x02];

/* Dots across the head: 576 for 80 mm paper, 384 for 58 mm, at 203 dpi. */
export const dotsFor = (paper) => (Number(paper) === 58 ? 384 : 576);

/* A canvas, as one bit per dot. A dot is printed when the pixel is darker
   than mid-grey, with transparency read as white paper. */
export function rasterise(imageData) {
  const { width, height, data } = imageData;
  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
      if (lum < 150) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bits, bytesPerRow, height };
}

/* `GS v 0`, in bands. Some printers cap one image at a few hundred rows, so a
   long receipt goes as a sequence of bands that print as one. Built into one
   array of its final size: a long receipt is megabytes, and pushing those a
   byte at a time is what made long receipts slow before they were cut off. */
export function rasterCommands({ bits, bytesPerRow, height }, band = 240) {
  const bands = Math.ceil(height / band);
  const out = new Uint8Array(bits.length + bands * 8);
  let at = 0;
  for (let top = 0; top < height; top += band) {
    const rows = Math.min(band, height - top);
    out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff], at);
    at += 8;
    out.set(bits.subarray(top * bytesPerRow, (top + rows) * bytesPerRow), at);
    at += rows * bytesPerRow;
  }
  return out;
}

export function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/* A whole job: reset, the picture, optionally the drawer, then the cut.

   `image` is one drawing or several — a receipt too long for one canvas is
   drawn in parts, which print one under the other with no gap. `cut` is
   "partial", "full", or null for a printer with no cutter; `true` is the
   partial cut it always meant. */
export function job(image, { drawer = false, cut = "partial", beep = false, drawerPin = 2 } = {}) {
  const parts = Array.isArray(image) ? image : [image];
  const chunks = [Uint8Array.from(INIT), ...parts.map((part) => rasterCommands(rasterise(part)))];
  if (drawer) chunks.push(Uint8Array.from(drawerPulse(drawerPin)));
  if (beep) chunks.push(Uint8Array.from(BEEP));
  const how = cut === true ? "partial" : cut;
  /* No cutter: feed far enough for the last line to clear the tear bar. */
  chunks.push(Uint8Array.from(CUTS[how] ? [...FEED, ...CUTS[how]] : [...FEED, 0x1b, 0x64, 0x03]));
  return concat(chunks);
}

export function drawerOnly(pin = 2) {
  return Uint8Array.from([...INIT, ...drawerPulse(pin)]);
}

export function toBase64(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
