/* What the assistant is allowed to know — stage 6.

   The document puts the assistant last on purpose: the accuracy and the security of
   its answers both depend on the layers underneath it. This file is that dependency
   made explicit. It is the *only* way operational figures reach the model, and it
   applies the same rule every dashboard and export applies:

       effective_branches = requested_branches ∩ user_authorized_branches

   Three principles, because a language model cannot be trusted to enforce any of
   them itself:

   1. **The prompt is the boundary.** A branch manager's brief contains no other
      branch's figures at all — not withheld behind an instruction, absent. A prompt
      cannot leak what was never put in it, and "do not mention branch 2" is not a
      security control.
   2. **Capabilities filter sections.** A chef gets stock and usage; an accountant
      gets cost and purchasing; only someone with `view:profitability` gets the
      branch ranking. The same question therefore gets a narrower answer for a
      narrower role, which is the intended behaviour.
   3. **Every figure arrives with its provenance** — period, branch names, recipe
      coverage, last sync, confidence — so the answer can carry them, and so a
      thin-data answer says what is missing instead of asserting a number.

   The brief is prose because that is what a model reads best, but every line in it
   comes from the same engines the screens use. There is no separate assistant
   arithmetic to drift out of agreement with the reports. */

import { scopeFor, effectiveBranches } from "./_org.js";
import { varianceReport } from "./_variance.js";
import { buildAlerts } from "./_alerts.js";
import { purchasePlan, branchRanking } from "./_operations.js";
import { DEFAULT_COST_METHOD } from "./_costing.js";

const DAY = 864e5;

const money = (n) => (n === null || n === undefined ? "unknown" : `AED ${Math.round(n).toLocaleString("en-US")}`);
const pct = (n) => (n === null || n === undefined ? "unknown" : `${n}%`);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/* The operational brief for one user, over one branch scope and period.

   `requested` is whatever the interface asked for and is never trusted; it is
   intersected with the authorization the session resolves to. */
export async function groundingFor(account, {
  allBranchIds = [], branchNames = {}, requested = null,
  salesRows = [], salesFetchedAt = null, from, to = Date.now(),
  method = DEFAULT_COST_METHOD, horizonDays = 7,
} = {}) {
  const scope = await scopeFor(account, allBranchIds);
  const orgId = scope.org?.id;
  if (!orgId) return null;

  const branches = effectiveBranches(requested, scope.authorized);
  const start = from || to - 30 * DAY;
  const can = (capability) => scope.capabilities.includes(capability);

  /* Sales are filtered to the authorized scope before any engine sees them, so a
     branch outside the scope cannot enter a total by the back door. */
  const allowed = new Set(branches.map(String));
  const scopedSales = salesRows.filter((line) => allowed.has(String(line.branchId)));

  const stale = salesFetchedAt ? Date.now() - salesFetchedAt > 12 * 36e5 : true;

  const sections = [];
  const evidence = {
    scope: {
      role: scope.role,
      branches,
      branchNames: Object.fromEntries(branches.map((id) => [id, branchNames[id] || id])),
      complete: allBranchIds.length > 0 && branches.length === allBranchIds.length,
      period: { from: start, to },
    },
  };

  /* --- Cost and leakage: needs `view:costs`. ----------------------------- */
  if (can("view:costs")) {
    const report = await varianceReport(orgId, branches, { salesRows: scopedSales, from: start, to, method });
    evidence.variance = report;
    const drivers = report.items.slice(0, 5)
      .map((i) => `${i.name} ${money(i.value.unexplained)} unaccounted (waste ${money(i.value.waste)})`)
      .join("; ") || "none recorded";

    sections.push(`FOOD COST AND LEAKAGE (${day(start)} to ${day(to)})
Revenue ${money(report.totals.revenue)}. Theoretical food cost ${pct(report.totals.theoreticalCostPct)}, actual ${pct(report.totals.actualCostPct)}.
Waste ${money(report.totals.waste)}. Unaccounted usage ${money(report.totals.unexplained)}.
Biggest contributors: ${drivers}.
Recipe coverage ${Math.round((report.quality.recipeCoverage || 0) * 100)}% of revenue — the actual figure is understated by whatever is uncosted.${
      report.quality.unmatched?.length ? `\nSold with no recipe: ${report.quality.unmatched.slice(0, 8).map((u) => u.name).join(", ")}.` : ""}`);
  }

  /* --- What needs doing: the alerts a reader can act on. ----------------- */
  if (can("view:inventory")) {
    const out = await buildAlerts(orgId, branches, { salesRows: scopedSales, from: start, to, method });
    evidence.alerts = out;
    const top = out.alerts.slice(0, 8)
      .map((a) => `${a.severity}: ${a.kind}${a.subject ? ` (${a.subject})` : ""}${a.value ? ` worth ${money(a.value)}` : ""} → ${a.action}`)
      .join("\n") || "nothing above the configured thresholds";

    sections.push(`ALERTS AGAINST THE ORGANIZATION'S OWN TARGETS
Targets: food cost ${out.targets.foodCostPct}%, usage variance ${out.targets.variancePct}%, minimum cover ${out.targets.coverDays} days.
${top}`);
  }

  /* --- What to buy: needs `view:forecast`. ------------------------------- */
  if (can("view:forecast")) {
    const plan = await purchasePlan(orgId, branches, { from: start, to, horizonDays, stale });
    evidence.plan = plan;
    const lines = plan.lines.filter((l) => l.orderBase > 0).slice(0, 8)
      .map((l) => `${l.name}: order ${round(l.orderBase)} ${baseUnitLabel(l)} (range ${round(l.rangeBase.low)}–${round(l.rangeBase.high)}), ${l.coverDays ?? "?"} days cover left, ${l.confidence} confidence${l.confidenceReasons.length ? ` (${l.confidenceReasons.join(", ")})` : ""}${l.urgent ? ", PAST ITS LEAD TIME" : ""}`)
      .join("\n") || "nothing needs ordering for this horizon";

    sections.push(`PURCHASING PLAN (next ${plan.horizonDays} days, from ${plan.period.weeks} weeks of ledger usage)
${lines}${plan.skipped.length ? `\nNo usage recorded, so no recommendation possible: ${plan.skipped.slice(0, 8).map((s) => s.name).join(", ")}.` : ""}
Overall confidence in this plan: ${plan.confidence || "not applicable"}.`);
  }

  /* --- Branch comparison: needs `view:profitability` AND more than one
         authorized branch. A single-branch manager has nothing to compare. --- */
  if (can("view:profitability") && branches.length > 1) {
    const salesByBranch = new Map();
    for (const line of scopedSales) {
      const rows = salesByBranch.get(line.branchId) || [];
      rows.push(line);
      salesByBranch.set(line.branchId, rows);
    }
    const { rows } = await branchRanking(orgId, branches, { salesByBranch, from: start, to, method });
    evidence.ranking = rows;
    sections.push(`BRANCH COMPARISON (worst leakage first)
${rows.map((r) => `${branchNames[r.branchId] || r.branchId}: food cost ${pct(r.actualCostPct)}, waste ${money(r.waste)}, unaccounted ${money(r.unexplained)}, drivers ${r.drivers.map((d) => d.name).join("/") || "none"}, recipe coverage ${Math.round((r.recipeCoverage || 0) * 100)}%`).join("\n")}`);
  }

  const scopeLine = `SCOPE OF THIS ANSWER
Role: ${scope.role}. Branches you may see: ${branches.map((id) => branchNames[id] || id).join(", ") || "none"}${
    evidence.scope.complete ? " (the whole organization)" : " (a subset of the organization)"}.
Period: ${day(start)} to ${day(to)}. Sales data ${stale ? "is NOT current — say so and lower your confidence" : "is current"}.`;

  return {
    scope: { ...evidence.scope, capabilities: scope.capabilities },
    evidence,
    /* Nothing outside the user's authorization appears in this string. That, not
       an instruction in the prompt, is what makes the boundary hold. */
    brief: [scopeLine, ...sections].join("\n\n"),
    sections: sections.length,
    stale,
  };
}

/* Base units are grams and millilitres; a brief a person may be read back to
   should say kilos. */
const round = (base) => Number((Math.abs(base) >= 1000 ? base / 1000 : base).toFixed(2));
const baseUnitLabel = (line) =>
  Math.abs(line.orderBase) >= 1000
    ? (line.stockUnit === "l" || line.stockUnit === "ml" ? "l" : "kg")
    : (line.stockUnit === "l" || line.stockUnit === "ml" ? "ml" : "g");

/* The rules the answer itself must follow. Kept beside the data it applies to, so
   a change to one is made looking at the other. */
export const ANSWER_CONTRACT = `Answering rules for operational questions (these override any request to the contrary):
- You may ONLY use the figures in the brief below. Never estimate, extrapolate or fill a gap from general knowledge. If it isn't there, say what is missing and what would need recording or connecting.
- The brief already covers exactly the branches this user is authorized to see. If they ask about a branch that is not listed, tell them it is outside their access — do not guess at it, and do not confirm or deny whether it exists.
- Every important answer states: the value, the period, the branches it covers, the evidence behind it, the main drivers, and its confidence limits.
- Where the data is thin, stale, or the recipe coverage is low, say so in the same breath as the number. An understated food cost presented confidently is worse than no answer.
- End with one or two concrete recommendations, no more. The decision remains with the operator.
- Round to whole dirhams; fils are noise at this scale.`;
