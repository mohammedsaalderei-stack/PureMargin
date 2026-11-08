/* A menu photo, made small enough to send and to show on a till.

   A phone camera takes a twelve-megapixel picture; a tile on the Sell screen
   is a hundred and fifty points wide. So the picture is cropped to a square
   from its centre, drawn at 480 pixels and saved as a JPEG here, on the
   device, before anything is uploaded — a few dozen kilobytes instead of
   several megabytes, which is what lets a menu of pictures load on a
   counter's Wi-Fi. */

import { resolveApiUrl } from "../platform.js";

const SIZE = 480;

export async function shrinkImage(file, size = SIZE) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("unreadable");
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    for (const quality of [0.82, 0.7, 0.55]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length * 0.75 < 380 * 1024) return data;
    }
    throw new Error("toolarge");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* The address to put in an `<img>`: in the app, the API's own host. */
export const pictureSrc = (path) => (path ? resolveApiUrl(path, globalThis.__pureMarginApiOrigin) : null);
