/* The POS adapter.

   Everything that is true of one particular till and not of tills in general
   lives here: the base URL, how a token is presented, what the endpoints are
   called, how pages are walked, and what each field is named in the response.
   The rest of the app works on the normalised shape at the bottom of this file
   and never sees a vendor's spelling.

   Loyverse was the first, and for a while it was the only one, so its
   assumptions were spread through the metrics module — `store_id`,
   `line_items`, `total_money`, a `cursor` field, a 31-day history cap. None of
   those are facts about point-of-sale systems; they are facts about Loyverse.

   Adding another till is now a matter of describing it here rather than
   editing the code that reads it. `POS_PROVIDER` selects one; unset, it stays
   Loyverse, so nothing that works today changes.

   A note on honesty: only the Loyverse adapter below has been run against a
   real account. The `custom` adapter is a described shape, not a tested one —
   it exists so somebody can point this at another till without waiting for a
   release, and it should be treated as a starting point to verify rather than
   a promise that it works. */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ── Loyverse ─────────────────────────────────────────────── */

const loyverse = {
  id: "loyverse",
  label: "Loyverse",
  base: "https://api.loyverse.com/v1.0",

  auth: (token) => ({ Authorization: `Bearer ${token}` }),

  /* Loyverse returns its own explanation in the body; a bare status code sends
     people hunting for a problem the response already named. */
  detail(body) {
    try {
      const parsed = JSON.parse(body);
      return parsed.details || parsed.message || parsed.error || "";
    } catch {
      return String(body || "").slice(0, 160);
    }
  },

  receiptsPath: (sinceIso, cursor) => {
    const qs = new URLSearchParams({ created_at_min: sinceIso, limit: "250" });
    if (cursor) qs.set("cursor", cursor);
    return `/receipts?${qs}`;
  },
  probePath: (sinceIso) => {
    const qs = new URLSearchParams({ created_at_min: sinceIso, limit: "1" });
    return `/receipts?${qs}`;
  },
  itemsPath: (cursor) => {
    const qs = new URLSearchParams({ limit: "250" });
    if (cursor) qs.set("cursor", cursor);
    return `/items?${qs}`;
  },
  storesPath: () => "/stores?limit=250",

  nextCursor: (page) => page?.cursor || null,
  receiptsOf: (page) => page?.receipts || [],
  itemsOf: (page) => page?.items || [],
  storesOf: (page) => page?.stores || [],

  receipt: (r) => ({
    branchId: String(r.store_id || "unknown"),
    at: new Date(r.receipt_date).getTime(),
    lines: (r.line_items || []).map((li) => ({
      name: li.item_name || "",
      variant: li.variant_name || "",
      qty: num(li.quantity),
      revenue: num(li.total_money),
      cost: num(li.cost_total) || null,
    })),
  }),

  item: (item) => ({
    name: item.item_name,
    image: item.image_url || null,
    category: item.category_id || null,
    variants: (item.variants || []).map((v) => ({
      name: v.variant_name || "",
      cost: num(v.cost),
    })),
  }),

  store: (s) => ({ id: String(s.id), name: s.name || String(s.id) }),

  /* A plan-imposed history ceiling. Loyverse answers 402 rather than returning
     a short list, which is why the ladder in _data.js probes rather than asks. */
  historyRefused: (status, message) =>
    status === 402 || /\b402\b|PAYMENT_REQUIRED|31 days/i.test(message || ""),

  /* Whether this till keeps stock of its own, and what it does not keep.

     Some tills track inventory and some do not, and the ones that do track a
     different thing from what a kitchen needs: a count against a catalogue
     item, not an ingredient with a unit, a pack size and a supplier. Offering
     "use my till's stock instead" without saying what is lost would be selling
     a downgrade as a convenience.

     `limits` are keys the interface translates, so the list is written once
     here by whoever knows the till and read in five languages. */
  inventory: {
    supported: true,
    path: () => "/inventory?limit=250",
    listOf: (page) => page?.inventory_levels || [],
    level: (row) => ({
      itemId: String(row.variant_id || row.item_id || ""),
      branchId: String(row.store_id || ""),
      qty: Number(row.in_stock),
    }),
    limits: ["noUnits", "noPackSize", "noSuppliers", "perVariant", "noCostHistory"],
  },
};

/* ── A till described entirely by environment ─────────────── */

/* Field names come from POS_FIELD_* variables, so another REST till with the
   same broad shape — a paged list of receipts, each with line items — can be
   connected without a release. Untested against any real system. */
const path = (obj, dotted) =>
  String(dotted || "").split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

const env = (name, fallback) => process.env[name] || fallback;

const custom = {
  id: "custom",
  label: env("POS_LABEL", "POS"),
  base: env("POS_API_BASE", ""),

  auth: (token) =>
    env("POS_AUTH_HEADER", "Authorization") === "Authorization"
      ? { Authorization: `${env("POS_AUTH_SCHEME", "Bearer")} ${token}`.trim() }
      : { [env("POS_AUTH_HEADER", "Authorization")]: token },

  detail: loyverse.detail,

  receiptsPath: (sinceIso, cursor) => {
    const qs = new URLSearchParams({ [env("POS_PARAM_SINCE", "created_at_min")]: sinceIso, limit: "250" });
    if (cursor) qs.set(env("POS_PARAM_CURSOR", "cursor"), cursor);
    return `${env("POS_PATH_RECEIPTS", "/receipts")}?${qs}`;
  },
  probePath: (sinceIso) => {
    const qs = new URLSearchParams({ [env("POS_PARAM_SINCE", "created_at_min")]: sinceIso, limit: "1" });
    return `${env("POS_PATH_RECEIPTS", "/receipts")}?${qs}`;
  },
  itemsPath: (cursor) => {
    const qs = new URLSearchParams({ limit: "250" });
    if (cursor) qs.set(env("POS_PARAM_CURSOR", "cursor"), cursor);
    return `${env("POS_PATH_ITEMS", "/items")}?${qs}`;
  },
  storesPath: () => env("POS_PATH_STORES", "/stores?limit=250"),

  nextCursor: (page) => path(page, env("POS_FIELD_CURSOR", "cursor")) || null,
  receiptsOf: (page) => path(page, env("POS_FIELD_RECEIPTS", "receipts")) || [],
  itemsOf: (page) => path(page, env("POS_FIELD_ITEMS", "items")) || [],
  storesOf: (page) => path(page, env("POS_FIELD_STORES", "stores")) || [],

  receipt: (r) => ({
    branchId: String(path(r, env("POS_FIELD_BRANCH", "store_id")) || "unknown"),
    at: new Date(path(r, env("POS_FIELD_DATE", "receipt_date"))).getTime(),
    lines: (path(r, env("POS_FIELD_LINES", "line_items")) || []).map((li) => ({
      name: path(li, env("POS_FIELD_LINE_NAME", "item_name")) || "",
      variant: path(li, env("POS_FIELD_LINE_VARIANT", "variant_name")) || "",
      qty: num(path(li, env("POS_FIELD_LINE_QTY", "quantity"))),
      revenue: num(path(li, env("POS_FIELD_LINE_TOTAL", "total_money"))),
      cost: null,
    })),
  }),

  item: (item) => ({
    name: path(item, env("POS_FIELD_ITEM_NAME", "item_name")),
    image: path(item, env("POS_FIELD_ITEM_IMAGE", "image_url")) || null,
    category: path(item, env("POS_FIELD_ITEM_CATEGORY", "category_id")) || null,
    variants: (path(item, env("POS_FIELD_VARIANTS", "variants")) || []).map((v) => ({
      name: path(v, env("POS_FIELD_VARIANT_NAME", "variant_name")) || "",
      cost: num(path(v, env("POS_FIELD_VARIANT_COST", "cost"))),
    })),
  }),

  store: (s) => ({
    id: String(path(s, env("POS_FIELD_STORE_ID", "id"))),
    name: path(s, env("POS_FIELD_STORE_NAME", "name")) || "",
  }),

  historyRefused: (status) => status === 402,

  /* Off unless somebody describes their till's stock endpoint. Claiming
     support and then returning nothing would look like an outage. */
  inventory: {
    supported: env("POS_PATH_INVENTORY", "") !== "",
    path: () => env("POS_PATH_INVENTORY", "/inventory?limit=250"),
    listOf: (page) => path(page, env("POS_FIELD_INVENTORY", "inventory_levels")) || [],
    level: (row) => ({
      itemId: String(path(row, env("POS_FIELD_LEVEL_ITEM", "variant_id")) || ""),
      branchId: String(path(row, env("POS_FIELD_LEVEL_BRANCH", "store_id")) || ""),
      qty: Number(path(row, env("POS_FIELD_LEVEL_QTY", "in_stock"))),
    }),
    /* Unknown till, so the caveats that apply to every till of this shape are
       stated and nothing is claimed beyond them. */
    limits: ["noUnits", "noPackSize", "noSuppliers", "unverified"],
  },
};

const PROVIDERS = { loyverse, custom };

export function provider() {
  const chosen = PROVIDERS[String(process.env.POS_PROVIDER || "loyverse").toLowerCase()];
  const p = chosen || loyverse;
  /* POS_API_BASE overrides whatever the provider declares, which is how a
     self-hosted or sandbox instance of the same till is pointed at. */
  return { ...p, base: process.env.POS_API_BASE || p.base };
}

export const providerNames = Object.keys(PROVIDERS);
export { loyverse, custom };
