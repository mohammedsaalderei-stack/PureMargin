/* The register over HTTP (the till).

   Named `till`, not `register`: `/api/register` is account sign-up.

   This is a till of its own — nothing here needs a POS connected. The
   organization and the branch always come from the session: a branch in a
   request is intersected with what the caller may use, and a price in a
   request is never read at all (see `_till.js`).

   Who may do what:
     use:till          sell, save tickets, open and close a shift, look up receipts
     adjust:sales      refunds and discounts nobody preset — or a manager's PIN
     manage:recipes    products, add-ons, a dish's price, barcodes and colours
     manage:costs      VAT, payment types, discounts, the receipt, loyalty, shifts
     manage:staff      who has a register PIN

   Once anybody in the business has a PIN, the register asks for one before
   it sells, and the operator it names — not the account the device is signed
   in as — is who the sale is put against and whose permissions apply. A
   cashier's PIN on the owner's device is a cashier.

   GET  ?what=catalogue | day | receipts | receipt | tickets | customers | shift | shifts | pins | stockitems
   POST ?what=sale | refund | pin | shift-open | shift-move | shift-close | email | device
   PUT  ?what=ticket | customer | addons | variants | image | price | vat | settings | product | item | pins
   DELETE ?what=ticket | product | pins | image
*/

import { requireAuth, issueDeviceToken } from "./_auth.js";
import { sendMail, configured as mailConfigured } from "./_mail.js";
import { receiptMail, receiptLanguages, allowSend, validEmail } from "./_receiptmail.js";
import { saveImage, removeImage } from "./_itemimages.js";
import { channelsForRegister, channelForSale, receiptEconomics, lineCostFrom } from "./_channels.js";
import { menuCosts } from "./_recipes.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { getMeta, listIngredients } from "./_inventory.js";
import { UNIT_KEYS, dimensionOf } from "./_units.js";
import { depleteFromSales } from "./_salesdepletion.js";
import { recordAudit } from "./_audit.js";
import { listRecipes, setSellPrice } from "./_recipes.js";
import {
  getSettings, catalogueOf, buildSale, buildRefund, recordSale, registerReceipts, saveAddons, saveVariants, saveVat,
  forDepletion, rosterFor, findReceipt, refundedSoFar, acceptNumber, monthsBetween, ORDER_TYPES,
} from "./_till.js";
import { currentShift, openShift, cashMove, closeShift, summarise, listShifts } from "./_tillshift.js";
import { saveTicket, listTickets, getTicket, deleteTicket, saveCustomer, listCustomers, getCustomer, customerStats } from "./_tillbook.js";
import { checkPin, readOperator, pinsInUse, listPins, setPin, removePin } from "./_tillstaff.js";
import { saveSection, saveProduct, archiveProduct, saveItemMeta } from "./_tillsetup.js";
import { listEmployees } from "./_employees.js";

const DAY = 24 * 60 * 60 * 1000;
const DEVICE_MANAGER_CAPS = ["adjust:sales", "manage:recipes", "manage:costs", "manage:staff"];

/* The branches a sale may be rung up in: the till's, or the register's own
   when there is no till. An unreachable till leaves none, rather than letting
   a sale be filed under a branch the till does not have. */
async function salesBranches(account) {
  try {
    return await rosterFor(account);
  } catch {
    return [];
  }
}

/* When a sale happened. A till that sold offline sends the moment it sold,
   which is the time on the customer's receipt; anything implausible is
   replaced with now rather than trusted. */
function saleTime(raw, now) {
  const at = Number(raw);
  return Number.isFinite(at) && at <= now + 5 * 60 * 1000 && at >= now - 7 * DAY ? at : now;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const roster = await salesBranches(session.account);
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });
    if (!scope.capabilities.includes("use:till")) return res.status(403).json({ error: "forbidden" });

    const what = String(req.query?.what || (req.method === "GET" ? "catalogue" : ""));
    const names = Object.fromEntries(roster.map((b) => [String(b.id), b.name]));
    const storeById = Object.fromEntries(roster.map((b) => [String(b.id), b]));
    const authorized = scope.authorized.map(String);
    const body = req.body || {};
    const now = Date.now();

    /* Who is at the register, from the PIN they gave, if the business uses
       PINs. Their role decides refunds and unplanned discounts; without PINs
       the account's own permissions do. */
    const operator = readOperator(req.headers?.["x-register-operator"], orgId, now);
    const needsOperator = await pinsInUse(orgId);

    /* On a register-only device the account behind it is not the person at
       the counter, so its permissions do not apply: whoever is there sells,
       and only a manager's PIN reaches what a manager may do. Everywhere else
       the account's own permissions do. */
    const registerOnly = Boolean(session.registerOnly);
    const can = (capability) => (registerOnly
      ? operator?.role === "manager" && DEVICE_MANAGER_CAPS.includes(capability)
      : scope.capabilities.includes(capability));
    const manager = operator ? operator.role === "manager" : can("adjust:sales");
    const actor = operator ? `${operator.name} (${session.username})` : session.username;
    const sellingAs = operator?.name || session.username;

    const oneBranch = (id) => {
      const b = effectiveBranches([String(id || "")], authorized);
      return b.length === 1 ? b[0] : null;
    };
    const audit = (action, detail = {}, target) =>
      recordAudit(orgId, { actor, action, ...(target ? { target } : {}), detail });

    res.setHeader("Cache-Control", "no-store");

    /* ── Reading ── */

    if (req.method === "GET" && what === "catalogue") {
      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      return res.status(200).json({
        items: catalogueOf(recipes, settings, { orgId }),
        vatPct: settings.vatPct,
        vatMode: settings.vatMode,
        paymentTypes: settings.paymentTypes,
        discounts: settings.discounts,
        receipt: { business: scope.org?.name || "", ...settings.receipt },
        loyaltyPct: settings.loyaltyPct,
        useShifts: settings.useShifts,
        orderTypes: ORDER_TYPES,
        /* Where an order can come from — the counter, a delivery app — each
           with the prices it lists and its fees, so a till with no connection
           still charges the right price for the channel. */
        channels: await channelsForRegister(orgId, authorized, { now, timeZone: scope.org?.timezone }),
        /* Each store's own address, phone and tax number, which its receipts
           print in place of the business-wide ones when set. */
        branches: authorized.map((id) => ({
          id, name: names[id] || id,
          address: storeById[id]?.address || "", phone: storeById[id]?.phone || "", trn: storeById[id]?.trn || "",
        })),
        pinsRequired: needsOperator,
        operator,
        device: {
          registerOnly,
          canLock: !registerOnly && (scope.capabilities.includes("manage:staff") || Boolean(scope.isOwner)),
        },
        can: {
          manageItems: can("manage:recipes"),
          manageSettings: can("manage:costs"),
          manageStaff: can("manage:staff"),
          refund: manager,
          customDiscount: manager,
        },
        canManageAddons: can("manage:recipes"),
        canManageVat: can("manage:costs"),
      });
    }

    /* A day's sales, for the register's own list. The window comes from the
       device, so "today" is the cashier's today rather than the server's; it
       is capped so this cannot become an export of everything. */
    if (req.method === "GET" && (what === "day" || what === "receipts")) {
      const to = Number(req.query?.to) || now;
      const from = Number(req.query?.from) || to - DAY;
      const limit = what === "day" ? 2 * DAY : 31 * DAY;
      if (!(to > from) || to - from > limit) return res.status(400).json({ error: "window" });
      const allowed = new Set(effectiveBranches(parseBranchParam(req.query?.branches), authorized).map(String));
      const q = String(req.query?.q || "").trim().toLowerCase();
      const receipts = (await registerReceipts(orgId, { since: from, now: to }))
        .filter((r) => allowed.has(String(r.store_id)))
        .filter((r) => !q || String(r.receipt_number).toLowerCase().includes(q)
          || String(r.ticket_name || "").toLowerCase().includes(q) || String(r.table || "").toLowerCase() === q);
      const sales = receipts.filter((r) => r.receipt_type !== "REFUND");
      const refunds = receipts.filter((r) => r.receipt_type === "REFUND");
      const sum = (list, pick) => Math.round(list.reduce((s, r) => s + pick(r), 0) * 100) / 100;
      const paid = (type) => sum(sales, (r) => (r.payments || []).filter((p) => p.type === type)
        .reduce((s, p) => s + (Number(p.money_amount) || 0), 0));
      return res.status(200).json({
        receipts: receipts.slice().reverse().slice(0, 300),
        totals: {
          count: sales.length,
          total: sum(sales, (r) => Number(r.total_money) || 0),
          refunded: sum(refunds, (r) => Number(r.total_money) || 0),
          tax: sum(sales, (r) => Number(r.total_tax) || 0),
          cash: paid("CASH"),
          card: paid("CARD"),
        },
      });
    }

    if (req.method === "GET" && what === "receipt") {
      const receipt = await findReceipt(orgId, String(req.query?.number || ""));
      if (!receipt || !authorized.includes(String(receipt.store_id))) return res.status(404).json({ error: "receipt" });
      const refunded = receipt.receipt_type === "SALE" ? await refundedSoFar(orgId, receipt.receipt_number) : { lines: {}, refunds: [] };
      return res.status(200).json({ receipt, refunded });
    }

    if (req.method === "GET" && what === "tickets") {
      return res.status(200).json({ tickets: await listTickets(orgId, authorized) });
    }

    if (req.method === "GET" && what === "customers") {
      const customers = await listCustomers(orgId);
      const since = customers.reduce((m, c) => Math.min(m, c.createdAt || now), now);
      const receipts = customers.length
        ? await registerReceipts(orgId, { since: Math.max(since, now - 730 * DAY), now })
        : [];
      return res.status(200).json({
        customers: customers.map((c) => ({ ...c, ...customerStats(c.id, receipts) })),
      });
    }

    if (req.method === "GET" && what === "shift") {
      const branch = oneBranch(req.query?.branchId);
      if (!branch) return res.status(403).json({ error: "branch" });
      const shift = await currentShift(orgId, branch);
      if (!shift) return res.status(200).json({ shift: null });
      const receipts = await registerReceipts(orgId, { since: shift.openedAt, now });
      return res.status(200).json({ shift, summary: summarise(shift, receipts) });
    }

    if (req.method === "GET" && what === "shifts") {
      const shifts = (await listShifts(orgId, monthsBetween(now - 92 * DAY, now)))
        .filter((s) => authorized.includes(String(s.branchId)));
      return res.status(200).json({ shifts: shifts.slice(0, 100) });
    }

    /* Stock items a product can be linked to, with the units that measure
       each, for the product form. */
    if (req.method === "GET" && what === "stockitems") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const list = await listIngredients(orgId);
      return res.status(200).json({
        items: list.map((i) => ({
          id: i.id, name: i.name, stockUnit: i.stockUnit,
          units: UNIT_KEYS.filter((u) => dimensionOf(u) === dimensionOf(i.stockUnit)),
        })),
      });
    }

    if (req.method === "GET" && what === "pins") {
      if (!can("manage:staff")) return res.status(403).json({ error: "forbidden" });
      const [pins, employees] = await Promise.all([listPins(orgId), listEmployees(orgId)]);
      return res.status(200).json({ pins, employees: employees.map((e) => ({ id: e.id, name: e.name, title: e.title || "" })) });
    }

    /* ── A receipt, emailed to the customer ──

       Any receipt from a store the caller may use, to one address at a time,
       a few times per receipt and so many a day per business
       (`allowSend`). The words are the server's own (`_receiptmail.js`);
       nothing in the request reaches the message but the address. */
    if (req.method === "POST" && what === "email") {
      const to = String(body.email || "").trim();
      if (!validEmail(to)) return res.status(400).json({ error: "email" });
      if (!mailConfigured) return res.status(503).json({ error: "mailoff" });
      const receipt = await findReceipt(orgId, String(body.number || ""));
      if (!receipt || !oneBranch(receipt.store_id)) return res.status(404).json({ error: "receipt" });
      const allowed = await allowSend(orgId, receipt.receipt_number, now);
      if (allowed.error) return res.status(429).json(allowed);
      const settings = await getSettings(orgId);
      const mail = receiptMail(receipt, {
        business: scope.org?.name || settings.receipt?.business || "",
        store: storeById[String(receipt.store_id)] || {},
        receiptSettings: settings.receipt || {},
        lang: receiptLanguages.includes(body.lang) ? body.lang : "en",
      });
      const sent = await sendMail({ to, ...mail });
      if (sent.error) return res.status(502).json({ error: "send" });
      return res.status(200).json({ sent: true });
    }

    /* ── Handing a device to staff ──

       Swaps this device's session for one that reaches the register and
       nothing else (`issueDeviceToken`). Taken by somebody signed in properly
       who may manage staff; a device that is already register-only cannot
       mint another. Leaving the mode is signing in again with a password. */
    if (req.method === "POST" && what === "device") {
      if (registerOnly || !(scope.capabilities.includes("manage:staff") || scope.isOwner)) {
        return res.status(403).json({ error: "forbidden" });
      }
      await audit("register.device", {});
      return res.status(200).json({ token: issueDeviceToken(session.username, session.account.tokenVersion || 0) });
    }

    /* ── Who is at the register ── */

    if (req.method === "POST" && what === "pin") {
      const out = await checkPin(orgId, body.pin, now);
      if (out.error === "locked") return res.status(429).json(out);
      if (out.error) return res.status(401).json(out);
      return res.status(200).json(out);
    }

    /* Everything below changes something, and once the business uses PINs
       it has to be somebody in particular who changed it. */
    if (needsOperator && !operator && ["sale", "refund", "ticket", "shift-open", "shift-move", "shift-close"].includes(what)) {
      return res.status(401).json({ error: "operator" });
    }

    /* ── Selling ── */

    if (req.method === "POST" && what === "sale") {
      /* One branch, and one the caller may sell in. */
      const branch = oneBranch(body.branchId);
      if (!branch) return res.status(403).json({ error: "branch" });

      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      const shift = await currentShift(orgId, branch);
      if (settings.useShifts && !shift) return res.status(409).json({ error: "noshift" });

      const at = saleTime(body.at, now);
      let pointsBalance = 0;
      if (body.customerId) {
        const customer = await getCustomer(orgId, body.customerId);
        if (!customer) return res.status(422).json({ error: "customer" });
        if (Number(body.redeemPoints) > 0) {
          const history = await registerReceipts(orgId, { since: customer.createdAt || at - 730 * DAY, now });
          pointsBalance = customerStats(customer.id, history).points;
        }
      }

      /* Where the order came from. The counter when nothing is said; otherwise
         a channel that exists, is in use and runs at this branch. Its listed
         prices are what the customer there was charged, and the fee rule in
         force when the order was made is the one it is costed under. */
      const via = await channelForSale(orgId, body.channelId, branch, { at, timeZone: scope.org?.timezone });
      if (via.error) return res.status(422).json({ error: "channel" });

      const built = buildSale(body, {
        catalogue: catalogueOf(recipes, settings),
        channel: via.channel,
        vatPct: settings.vatPct,
        vatMode: settings.vatMode,
        paymentTypes: settings.paymentTypes,
        discounts: settings.discounts,
        loyaltyPct: settings.loyaltyPct,
        pointsBalance,
        branchId: branch,
        at,
        number: body.number ? await acceptNumber(orgId, body.number, at) : undefined,
        cashier: sellingAs,
        employeeId: operator?.employeeId || "",
        shiftId: shift?.id || "",
        clientId: body.clientId || "",
      });
      if (built.error) return res.status(422).json(built);

      /* A discount nobody preset, or one a manager reserved, is a manager's
         to give. Checked against what was actually applied, after building. */
      const needsManager = (built.receipt.discounts || []).some((d) => d.custom || d.restricted);
      if (needsManager && !manager) return res.status(403).json({ error: "discount" });

      /* What this order is worth on its channel, written onto the receipt
         with a copy of the fee rule it was worked out under — so a commission
         changed next month moves nothing about this sale. Recipe costs are
         today's, which is what "what did this order make" means on the day.
         Best-effort: a sale is never refused because it could not be costed. */
      try {
        const costOf = lineCostFrom(await menuCosts(orgId, [branch], { at }));
        for (const li of built.receipt.line_items) {
          const unit = costOf(li);
          if (unit !== null) li.recipe_cost = Math.round(unit * 10000) / 10000;
        }
        built.receipt.channel_fee_rule = via.rule;
        built.receipt.channel_economics = receiptEconomics(built.receipt, via.rule, costOf, { at: now });
      } catch (err) {
        console.error("channel economics failed:", err?.message || err);
      }

      const saved = await recordSale(orgId, built.receipt);
      if (saved.duplicate) return res.status(200).json({ receipt: saved, duplicate: true });

      /* Stock leaves the shelf when the sale is made, through the same code the
         till's receipts go through. Best-effort and idempotent by receipt
         number: a failure here must never lose the sale, which is already
         saved, and anything not depleted now is depleted on a later pass. */
      let depletion = null;
      try {
        const meta = await getMeta(orgId);
        if (meta.autoDepleteFromSales) {
          depletion = await depleteFromSales(orgId, branch, [forDepletion(built.receipt)], { actor: sellingAs });
        }
      } catch (err) {
        console.error("register depletion failed:", err?.message || err);
      }

      /* A ticket that has now been paid is closed. */
      if (body.ticketId) await deleteTicket(orgId, body.ticketId).catch(() => {});

      return res.status(201).json({
        receipt: built.receipt,
        depletion: depletion ? { movements: depletion.movements, unmatched: depletion.unmatched } : null,
      });
    }

    if (req.method === "POST" && what === "refund") {
      if (!manager) return res.status(403).json({ error: "forbidden" });
      const sale = await findReceipt(orgId, String(body.number || ""));
      if (!sale || !authorized.includes(String(sale.store_id))) return res.status(404).json({ error: "receipt" });
      const settings = await getSettings(orgId);
      const shift = await currentShift(orgId, sale.store_id);
      if (settings.useShifts && !shift) return res.status(409).json({ error: "noshift" });
      const already = await refundedSoFar(orgId, sale.receipt_number);
      const built = buildRefund(sale, {
        lines: body.lines,
        at: now,
        reason: body.reason,
        cashier: sellingAs,
        employeeId: operator?.employeeId || "",
        shiftId: shift?.id || "",
        already: already.lines,
        paymentType: body.paymentType,
        paymentTypes: settings.paymentTypes,
      });
      if (built.error) return res.status(422).json(built);
      if (body.clientId) built.receipt.client_id = String(body.clientId).slice(0, 80);
      const saved = await recordSale(orgId, built.receipt);
      if (!saved.duplicate) {
        await audit("register.refund", { refund: saved.receipt_number, total: saved.total_money, reason: saved.reason }, sale.receipt_number);
      }
      return res.status(201).json({ receipt: saved });
    }

    /* ── Open tickets ── */

    if (req.method === "PUT" && what === "ticket") {
      const branch = oneBranch(body.branchId);
      if (!branch) return res.status(403).json({ error: "branch" });
      const out = await saveTicket(orgId, body, { by: sellingAs, branchId: branch, at: now });
      if (out.error) return res.status(422).json(out);
      return res.status(200).json(out);
    }

    if (req.method === "DELETE" && what === "ticket") {
      const ticket = await getTicket(orgId, req.query?.id);
      if (!ticket || !authorized.includes(String(ticket.branchId))) return res.status(404).json({ error: "ticket" });
      /* Throwing away an order somebody else took is a void, and a manager's. */
      if (!manager && ticket.createdBy !== sellingAs) return res.status(403).json({ error: "forbidden" });
      await deleteTicket(orgId, ticket.id);
      await audit("register.void", { name: ticket.name, lines: ticket.lines.length }, ticket.id);
      return res.status(200).json({ deleted: true });
    }

    /* ── Customers ── */

    if (req.method === "PUT" && what === "customer") {
      const out = await saveCustomer(orgId, body, { at: now });
      if (out.error) return res.status(422).json(out);
      return res.status(200).json(out);
    }

    /* ── Shifts ── */

    if (req.method === "POST" && what.startsWith("shift-")) {
      const branch = oneBranch(body.branchId);
      if (!branch) return res.status(403).json({ error: "branch" });

      if (what === "shift-open") {
        const out = await openShift(orgId, branch, { float: body.float, by: sellingAs, employeeId: operator?.employeeId, at: now });
        if (out.error) return res.status(409).json(out);
        await audit("register.shift.open", { branchId: branch, float: out.shift.float }, out.shift.id);
        return res.status(201).json(out);
      }
      if (what === "shift-move") {
        const out = await cashMove(orgId, branch, { type: body.type, amount: body.amount, note: body.note, by: sellingAs, at: now });
        if (out.error) return res.status(422).json(out);
        await audit("register.cash", { type: body.type, amount: Number(body.amount), note: body.note }, out.shift.id);
        return res.status(200).json(out);
      }
      if (what === "shift-close") {
        const shift = await currentShift(orgId, branch);
        if (!shift) return res.status(409).json({ error: "noshift" });
        const receipts = await registerReceipts(orgId, { since: shift.openedAt, now });
        const out = await closeShift(orgId, branch, { counted: body.counted, note: body.note, by: sellingAs, receipts, at: now });
        if (out.error) return res.status(422).json(out);
        await audit("register.shift.close", {
          branchId: branch, expected: out.shift.summary.cash.expected, counted: out.shift.counted, difference: out.shift.difference,
        }, out.shift.id);
        return res.status(200).json(out);
      }
    }

    /* ── Setting the register up ── */

    if (req.method === "PUT" && what === "pins") {
      if (!can("manage:staff")) return res.status(403).json({ error: "forbidden" });
      const employees = await listEmployees(orgId);
      const person = employees.find((e) => e.id === String(body.employeeId || ""));
      if (!person) return res.status(404).json({ error: "employee" });
      const out = await setPin(orgId, { employeeId: person.id, name: person.name, pin: body.pin, role: body.role });
      if (out.error) return res.status(422).json(out);
      await audit("register.pin", { employee: person.name, role: out.role }, person.id);
      return res.status(200).json(out);
    }

    if (req.method === "DELETE" && what === "pins") {
      if (!can("manage:staff")) return res.status(403).json({ error: "forbidden" });
      await removePin(orgId, String(req.query?.employeeId || ""));
      await audit("register.pin", { removed: true }, String(req.query?.employeeId || ""));
      return res.status(200).json({ removed: true });
    }

    if (req.method === "PUT" && what === "settings") {
      if (!can("manage:costs")) return res.status(403).json({ error: "forbidden" });
      const out = await saveSection(orgId, String(body.section || ""), body.value);
      if (out.error) return res.status(422).json(out);
      await audit("register.settings", { section: body.section });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "PUT" && what === "product") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const out = await saveProduct(orgId, body);
      if (out.error) return res.status(422).json(out);
      await audit("register.product", { name: out.product.name, price: out.product.price }, out.id);
      return res.status(200).json(out);
    }

    if (req.method === "DELETE" && what === "product") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const out = await archiveProduct(orgId, String(req.query?.id || ""));
      if (out.error) return res.status(404).json(out);
      await audit("register.product", { archived: true }, String(req.query?.id || ""));
      return res.status(200).json(out);
    }

    if (req.method === "PUT" && what === "item") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const out = await saveItemMeta(orgId, body.itemId, body);
      if (out.error) return res.status(422).json(out);
      return res.status(200).json(out);
    }

    /* A picture for an item, already shrunk on the device (`itemImage.js`);
       checked and capped here all the same. */
    if (req.method === "PUT" && what === "image") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      const itemId = String(body.itemId || "");
      const known = recipes.some((r) => String(r.id) === itemId) || Boolean(settings.products[itemId]);
      if (!known) return res.status(404).json({ error: "item" });
      const out = await saveImage(orgId, itemId, body.image);
      if (out.error) return res.status(out.error === "toolarge" ? 413 : 422).json(out);
      await audit("register.image", { itemId, bytes: out.bytes });
      return res.status(200).json(out);
    }

    if (req.method === "DELETE" && what === "image") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      await removeImage(orgId, String(req.query?.id || ""));
      await audit("register.image", { itemId: String(req.query?.id || ""), removed: true });
      return res.status(200).json({ removed: true });
    }

    if (req.method === "PUT" && what === "variants") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      const itemId = String(body.itemId || "");
      const known = recipes.some((r) => String(r.id) === itemId) || Boolean(settings.products[itemId]);
      if (!known) return res.status(404).json({ error: "item" });
      const out = await saveVariants(orgId, itemId, body.variants);
      if (out.error) return res.status(422).json(out);
      await audit("register.variants", { itemId, count: out.variants.length });
      return res.status(200).json(out);
    }

    if (req.method === "PUT" && what === "addons") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      const itemId = String(body.itemId || "");
      const known = recipes.some((r) => String(r.id) === itemId) || Boolean(settings.products[itemId]);
      if (!known) return res.status(404).json({ error: "item" });
      const out = await saveAddons(orgId, itemId, body.addons);
      if (out.error) return res.status(422).json(out);
      await audit("register.addons", { itemId, count: out.addons.length });
      return res.status(200).json(out);
    }

    /* A dish's selling price, set where it is first needed. It is the recipe's
       price, so it moves every margin the dish appears in, and is logged like
       any other change to what the business charges. */
    if (req.method === "PUT" && what === "price") {
      if (!can("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const itemId = String(body.itemId || "");
      const before = (await listRecipes(orgId)).find((r) => String(r.id) === itemId);
      const out = await setSellPrice(orgId, itemId, body.price);
      if (out.error === "notfound") return res.status(404).json({ error: "item" });
      if (out.error) return res.status(422).json(out);
      await audit("register.price", { from: before?.sellPrice ?? null, to: out.recipe.sellPrice }, itemId);
      return res.status(200).json({ itemId, price: out.recipe.sellPrice });
    }

    if (req.method === "PUT" && what === "vat") {
      if (!can("manage:costs")) return res.status(403).json({ error: "forbidden" });
      const before = (await getSettings(orgId)).vatPct;
      const out = await saveVat(orgId, body.vatPct);
      if (out.error) return res.status(422).json(out);
      await audit("register.vat", { from: before, to: out.vatPct });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Unknown register request." });
  } catch (err) {
    console.error("register failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
