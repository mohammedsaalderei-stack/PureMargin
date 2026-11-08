/* Pictures of menu items.

   Kept one per item under its own key, never inside the register's settings:
   the settings are read on every sale and every catalogue load, and a menu of
   pictures inside them would make each of those reads megabytes. The
   settings hold only each picture's version (`settings.images[itemId]`),
   which is what goes into its address.

   The picture is served from `/api/itemimage` by a signed address rather than
   behind the session, so an `<img>` can show it — a tag cannot send a bearer
   token — and a register-only device, whose token reaches nothing but the
   till, can still draw its menu. The signature names the organization, the
   item and the version, so an address cannot be edited into another
   business's pictures. The version changes with the picture, so the address
   can be cached for good: a new picture is a new address. */

import crypto from "crypto";
import { getJSON, setJSON, del } from "./_store.js";
import { imageUrl } from "./_imageurl.js";
import { getSettings, putSettings } from "./_till.js";

const KEY = (orgId, itemId) => `register:${orgId}:img:${itemId}`;
export const MAX_IMAGE_BYTES = 400 * 1024;

/* What the bytes are, from the bytes — never the type a client claims. */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/* `data` is base64, or a data: URL. */
export async function saveImage(orgId, itemId, data) {
  const b64 = String(data || "").replace(/^data:[^;,]+;base64,/, "");
  if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return { error: "image" };
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return { error: "image" };
  if (buf.length > MAX_IMAGE_BYTES) return { error: "toolarge", limit: MAX_IMAGE_BYTES };
  const type = sniff(buf);
  if (!type) return { error: "type" };
  const v = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  await setJSON(KEY(orgId, itemId), { type, data: buf.toString("base64"), v, at: Date.now() });
  const settings = await getSettings(orgId);
  await putSettings(orgId, { ...settings, images: { ...settings.images, [String(itemId)]: v } });
  return { v, type, bytes: buf.length, url: imageUrl(orgId, itemId, v) };
}

export async function removeImage(orgId, itemId) {
  await del(KEY(orgId, itemId));
  const settings = await getSettings(orgId);
  const images = { ...settings.images };
  delete images[String(itemId)];
  await putSettings(orgId, { ...settings, images });
  return { removed: true };
}

export async function readImage(orgId, itemId) {
  return getJSON(KEY(orgId, itemId));
}
