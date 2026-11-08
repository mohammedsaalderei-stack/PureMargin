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
/* Feed a few lines so the cut falls below the last line, then a partial cut. */
export const FEED_AND_CUT = [0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00];
/* Pulse the cash drawer on pin 2 for 50 ms on, 500 ms off. The drawer plugs
   into the printer, not the device, so this is how a till opens it. */
export const OPEN_DRAWER = [0x1b, 0x70, 0x00, 0x19, 0xfa];
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
   long receipt goes as a sequence of bands that print as one. */
export function rasterCommands({ bits, bytesPerRow, height }, band = 240) {
  const out = [];
  for (let top = 0; top < height; top += band) {
    const rows = Math.min(band, height - top);
    out.push(0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      rows & 0xff, (rows >> 8) & 0xff);
    const slice = bits.subarray(top * bytesPerRow, (top + rows) * bytesPerRow);
    for (let i = 0; i < slice.length; i += 1) out.push(slice[i]);
  }
  return out;
}

/* A whole job: reset, the picture, optionally the drawer, then the cut. */
export function job(imageData, { drawer = false, cut = true, beep = false } = {}) {
  const bytes = [...INIT, ...rasterCommands(rasterise(imageData))];
  if (drawer) bytes.push(...OPEN_DRAWER);
  if (beep) bytes.push(...BEEP);
  if (cut) bytes.push(...FEED_AND_CUT);
  return Uint8Array.from(bytes);
}

export function drawerOnly() {
  return Uint8Array.from([...INIT, ...OPEN_DRAWER]);
}

export function toBase64(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
