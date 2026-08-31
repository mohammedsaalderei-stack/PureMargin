/* What the assistant is allowed to know about, per person.

   Every screen in this product is gated. The assistant was not: it read the
   full metrics and answered from them, so a cashier who could not open the
   dashboard could ask "what was our margin last month" and be told. The
   permission model was doing careful work on the nav and the assistant walked
   straight past it.

   Redacted before the model sees anything, not after. Asking a model to keep a
   secret it has been handed is not a control — it is a request, and the first
   cleverly-worded question gets round it. Figures somebody may not see are
   removed from the context, so the model cannot reveal what it never had.

   The consequence is deliberate: a cashier asking about margin gets "I don't
   have that" rather than a refusal. That is also the honest answer, because
   from where the model is standing it is true. */

/* What each part of the context requires. Anything not listed here is
   available to anybody who can reach the assistant at all — sales counts,
   busiest hours, what sold. */
const NEEDS = {
  cost: "view:costs",
  costPct: "view:costs",
  margin: "view:profitability",
  marginPct: "view:profitability",
  profit: "view:profitability",
  netProfit: "view:profitability",
  grossProfit: "view:profitability",
  foodCostPct: "view:profitability",
  itemCost: "view:costs",
  itemMargin: "view:profitability",
};

const has = (caps, need) => Array.isArray(caps) && caps.includes(need);

/* Strip by key name, at any depth.

   Matched on the name rather than a path because the context is assembled from
   several sources and reshaped over time; a path list would go stale silently
   and start leaking the moment somebody renamed a section. A name list fails
   the other way — it strips a bit more than strictly necessary — which is the
   right direction to be wrong in. */
function strip(value, caps) {
  if (Array.isArray(value)) return value.map((v) => strip(v, caps));
  if (!value || typeof value !== "object") return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const need = NEEDS[k];
    if (need && !has(caps, need)) continue;
    out[k] = strip(v, caps);
  }
  return out;
}

export function redactContext(context, capabilities) {
  /* Undefined means unrestricted — a caller that does not know about
     capabilities, such as a test, still sees everything. Null or an empty
     array means a person with none, and they get the stripped version. */
  if (capabilities === undefined) return context;
  return strip(context, capabilities);
}

/* A line for the prompt naming what was withheld, so the model says "I do not
   have that" rather than inventing a number to fill the gap. Silence about a
   missing figure is what produces a confident guess. */
export function redactionNote(capabilities) {
  if (capabilities === undefined) return "";

  const missing = [];
  if (!has(capabilities, "view:costs")) missing.push("ingredient costs");
  if (!has(capabilities, "view:profitability")) missing.push("margins and profit");
  if (!missing.length) return "";

  return `\n\nThis person's role does not include ${missing.join(" or ")}, so those
figures are not in the data above. If they ask about them, say plainly that you
do not have those numbers for them and suggest they ask the account owner. Do
not estimate, and do not infer them from anything else you can see.`;
}
