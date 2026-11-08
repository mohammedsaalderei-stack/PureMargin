/* GET /api/itemimage?o=&i=&v=&s= — a menu item's picture, by signed address.

   No session: an `<img>` cannot send one. The signature is the permission
   (`_itemimages.js`), and the version in it must be the picture's current
   one, so an old address stops working when the picture is replaced or
   removed rather than serving what was taken down. */

import { readImage } from "./_itemimages.js";
import { verifyImageUrl } from "./_imageurl.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
  const q = req.query || {};
  if (!verifyImageUrl(q)) return res.status(403).json({ error: "forbidden" });
  try {
    const img = await readImage(String(q.o), String(q.i));
    if (!img || img.v !== String(q.v)) return res.status(404).json({ error: "notfound" });
    const buf = Buffer.from(img.data, "base64");
    res.setHeader("Content-Type", img.type);
    res.setHeader("Content-Length", String(buf.length));
    /* The version is in the address, so the bytes behind it never change. */
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.statusCode = 200;
    res.end(buf);
    return undefined;
  } catch (err) {
    console.error("item image failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
