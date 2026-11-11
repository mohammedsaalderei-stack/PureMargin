/* Sales and delivery channels over HTTP.

   GET                      channels and their rules, listed prices, the menu
                            with what each item costs, alerts, and what each
                            channel brought in (?days=30, ?branch=<id>)
   POST ?what=channel       add a channel, or rename / switch one off
   POST ?what=rule          a new fee rule for a channel, from a date
   PUT  ?what=prices        set or clear listed prices on a channel
   POST ?what=copy          give one channel another's prices
   PUT  ?what=settings      the margin below which a price is flagged

   Reading needs `view:profitability` — this is what the business keeps, item
   by item. Changing anything needs `manage:costs`. The organization always
   comes from the session. */

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches } from "./_org.js";
import { recordAudit } from "./_audit.js";
import { listRecipes, menuCosts } from "./_recipes.js";
import { getSettings, catalogueOf, rosterFor, registerReceipts } from "./_till.js";
import {
  listChannels, channelSettings, saveSettings, saveChannel, addRule, pricesFor, setPrices, copyPrices,
  menuRows, channelAlerts, channelReport, pricingGap,
} from "./_channels.js";

const DAY = 864e5;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const roster = await rosterFor(session.account);
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });
    const can = (c) => scope.capabilities.includes(c);
    if (!can("view:profitability")) return res.status(403).json({ error: "forbidden" });
    const timeZone = scope.org?.timezone || "Asia/Dubai";
    const what = String(req.query?.what || "");
    const body = req.body || {};
    const now = Date.now();
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const authorized = scope.authorized.map(String);
      const branch = effectiveBranches([String(req.query?.branch || "")], authorized)[0] || null;
      const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 366);
      const [channels, settings, { doc, byChannel }, recipes, till, costs] = await Promise.all([
        listChannels(orgId, { now }), channelSettings(orgId), pricesFor(orgId), listRecipes(orgId), getSettings(orgId),
        menuCosts(orgId, authorized),
      ]);
      const rows = menuRows(catalogueOf(recipes, till), costs);
      const receipts = till.usedAt ? await registerReceipts(orgId, { since: now - (days + 1) * DAY }) : [];
      const { alerts, more } = channelAlerts({
        channels, prices: byChannel, rows, vatPct: till.vatPct, vatMode: till.vatMode, settings, pricesDoc: doc, now, timeZone, branchId: branch,
      });
      return res.status(200).json({
        channels, prices: byChannel, items: rows,
        vatPct: till.vatPct, vatMode: till.vatMode, currency: "AED",
        settings, alerts, alertsMore: more,
        report: channelReport(receipts, { channels, costs, from: now - days * DAY, to: now, branches: authorized }),
        pricingGap: pricingGap(rows, byChannel, channels),
        days, branch, branches: roster.filter((b) => authorized.includes(String(b.id))).map((b) => ({ id: b.id, name: b.name })),
        can: { manage: can("manage:costs") },
      });
    }

    if (!can("manage:costs")) return res.status(403).json({ error: "forbidden" });
    const audit = (action, detail, target) => recordAudit(orgId, { actor: session.username, action, target, detail });

    if (req.method === "POST" && what === "channel") {
      const out = await saveChannel(orgId, body, { now });
      if (out.error) return res.status(out.error === "notfound" ? 404 : 422).json(out);
      await audit("channel.save", { name: out.channel.name, active: out.channel.active, created: out.created }, out.channel.id);
      return res.status(out.created ? 201 : 200).json(out);
    }

    if (req.method === "POST" && what === "rule") {
      /* A rule for one branch has to be a branch this person may manage. */
      if (body.branchId && !effectiveBranches([String(body.branchId)], scope.authorized.map(String)).length) {
        return res.status(403).json({ error: "branch" });
      }
      const out = await addRule(orgId, String(body.channelId || ""), body, { by: session.username, now, timeZone });
      if (out.error) return res.status(out.error === "notfound" ? 404 : 422).json(out);
      await audit("channel.rule", { validFrom: out.rule.validFrom, commissionPct: out.rule.commissionPct, branchId: out.rule.branchId }, out.channel.id);
      return res.status(201).json(out);
    }

    if (req.method === "PUT" && what === "prices") {
      const out = await setPrices(orgId, String(body.channelId || ""), body.prices, { by: session.username, now });
      if (out.error) return res.status(out.error === "notfound" ? 404 : 422).json(out);
      if (out.changed) await audit("channel.prices", { changed: out.changed }, String(body.channelId));
      return res.status(200).json(out);
    }

    if (req.method === "POST" && what === "copy") {
      const out = await copyPrices(orgId, String(body.from || ""), String(body.to || ""), { by: session.username, now });
      if (out.error) return res.status(out.error === "notfound" ? 404 : 422).json(out);
      if (out.changed) await audit("channel.prices", { changed: out.changed, copiedFrom: String(body.from) }, String(body.to));
      return res.status(200).json(out);
    }

    if (req.method === "PUT" && what === "settings") {
      const out = await saveSettings(orgId, body);
      if (out.error) return res.status(422).json(out);
      await audit("channel.settings", { minMarginPct: out.settings.minMarginPct });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET, POST or PUT." });
  } catch (err) {
    console.error("channels endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
