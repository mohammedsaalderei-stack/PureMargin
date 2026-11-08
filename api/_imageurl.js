/* The signed address of a menu item's picture (see `_itemimages.js`). Its
   own module so the catalogue can name pictures without importing the
   storage that imports the catalogue. */

import crypto from "crypto";
import { signScoped } from "./_auth.js";

const sign = (orgId, itemId, v) => signScoped("itemimage", `${orgId}|${itemId}|${v}`);

export function imageUrl(orgId, itemId, v) {
  if (!orgId || !itemId || !v) return null;
  const q = new URLSearchParams({ o: orgId, i: itemId, v, s: sign(orgId, itemId, v) });
  return `/api/itemimage?${q.toString()}`;
}

export function verifyImageUrl({ o, i, v, s } = {}) {
  if (!o || !i || !v || !s) return false;
  const want = Buffer.from(sign(String(o), String(i), String(v)));
  const got = Buffer.from(String(s));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
