/* Small parts every channel view uses. */

import { ruleAt, EMPTY_RULE, IN_STORE_ID, compareItem } from "../../shared/channelmath.js";

export const fmt = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(2));
export const pct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : `${Number(n).toFixed(1)}%`);

/* Today, as the business's device has it. The server resolves rules in the
   business's own timezone; a device a few hours out only matters on the day
   a rule starts, and the server's figure is the one an order is costed by. */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const ruleNow = (channel, branch) => ruleAt(channel?.rules, today(), branch || null) || EMPTY_RULE;

export function labelOf(row) {
  return row.variant ? `${row.name} · ${row.variant}` : row.name;
}

/* What an item comes to on a channel at a price, against the counter. */
export function economicsOf(data, row, channel, price) {
  const counter = data.channels.find((c) => c.id === IN_STORE_ID);
  return compareItem({
    price, inStorePrice: row.price, recipeCost: row.cost,
    rule: ruleNow(channel, data.branch), inStoreRule: ruleNow(counter, data.branch),
    vatPct: data.vatPct, vatMode: data.vatMode, minMarginPct: data.settings?.minMarginPct || 0,
  });
}

export const STATUS_COLOR = (C) => ({ green: C.mint, orange: C.amber, red: C.rose, unknown: C.slate });

export function StatusDot({ status, C, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: STATUS_COLOR(C)[status] }}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR(C)[status] }} />
      {label}
    </span>
  );
}
