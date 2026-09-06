/* The stock ledger over HTTP — stage 4, phase 2.

   Kept apart from `api/inventory.js` because the two answer different questions
   and are gated differently in practice: that route is master data (what an
   ingredient IS), this one is history (what happened to it, and where). Merging
   them would also merge their branch handling, and this is the route where
   branch scope matters most — every entry belongs to exactly one branch.

   Authorization, per the direction document, is the intersection and nothing
   else: `effective_branches = requested_branches ∩ user_authorized_branches`.
   A branch id in a request body is a *request*, never a grant. A branch manager
   who edits the id posts into their own scope or gets a 403; there is no shape
   of this request that writes into a branch they can't already see.

   GET     ?what=balances[&branches=a,b]  — derived on-hand, per ingredient
           ?what=ledger&branch=<id>[&ingredientId=&type=&from=&to=]
   POST    ?what=invoice    — a scanned supplier invoice, whole: creates missing
                              ingredients, receives every line, learns what the
                              supplier calls each of them
           ?what=movement   — one entry, body { branchId, ingredientId, type, qty, unit, ... }
           ?what=transfer   — two linked entries between branches
           ?what=reverse    — the only correction: body { branchId, id, reason }
           ?what=undo-delivery — reverse every entry one scanned invoice wrote
           ?what=policy     — negative-stock policy, owner-level (manage:inventory)
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam, can } from "./_org.js";
import { getMeta } from "./_inventory.js";
import { posTokenFor } from "./_accounts.js";
import { receiptsFor } from "./_data.js";
import { depleteFromSales } from "./_salesdepletion.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { listIngredients, saveIngredient } from "./_inventory.js";
import { learnAliases } from "./_aliases.js";
import { costBasis, costFrom, evidenceFor } from "./_costing.js";
import { unitsByDimension, toBase, unitLabel } from "./_units.js";
import { resolveUnit, isPackaging } from "./_unitwords.js";
import { fingerprint, findRepeat, rememberInvoice, getInvoice, markUndone } from "./_invoicelog.js";
import {
  MOVEMENT_KEYS, recordMovement, recordTransfer, reverseMovement,
  listMovements, balances, getPolicy, savePolicy,
} from "./_movements.js";

/* Branches come from the POS (phase 1's decision: a branch is a store, not a
   local table), so a missing connection means no branches rather than an error. */
async function branchesFor(session) {
  try {
    return await branchList(await posTokenFor(session.username));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const roster = await branchesFor(session);
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    const may = (capability) => scope.capabilities.includes(capability);
    if (!may("view:inventory")) return res.status(403).json({ error: "forbidden" });

    const what = String(req.query?.what || "balances");
    const allowed = scope.authorized;
    /* One helper for every branch id that arrives from a client, so no route
       below can forget the intersection. */
    const permitted = (id) => effectiveBranches([String(id || "")], allowed);

    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      if (what === "ledger") {
        const branch = permitted(req.query?.branch);
        if (!branch.length) return res.status(403).json({ error: "branch" });
        return res.status(200).json({
          branchId: branch[0],
          movements: await listMovements(orgId, branch[0], {
            ingredientId: String(req.query?.ingredientId || "") || undefined,
            type: String(req.query?.type || "") || undefined,
            from: Number(req.query?.from) || undefined,
            to: Number(req.query?.to) || undefined,
          }),
        });
      }

      /* Balances default to everything the user may see, which is what keeps an
         owner's view one consolidated total rather than a branch at a time. */
      const branches = effectiveBranches(parseBranchParam(req.query?.branches), allowed);
      const ingredients = await listIngredients(orgId, { includeArchived: true });

      /* What each thing on the shelf is worth, alongside how much of it there
         is. The two were separate calls, so the stock screen showed quantities
         and the recipe screen showed costs and nothing showed both — while the
         question anybody actually has about a store is what is in it and what
         that is worth.

         Stated per stock unit rather than per base, because that is the unit
         the row beside it is counted in: "22.80 per kg" against "45.5 kg". A
         cost per gram next to a quantity in kilos is arithmetic homework. */
      const basis = await costBasis(orgId, branches);
      const rows = (await balances(orgId, branches, { ingredients })).map((row) => {
        const perBase = costFrom(basis, row.ingredientId);
        const perStockUnit = perBase === null ? null : perBase * toBase(1, row.stockUnit);
        return {
          ...row,
          avgCost: perStockUnit === null ? null : Math.round(perStockUnit * 10000) / 10000,
          value: perBase === null ? null : Math.round(row.qtyBase * perBase * 100) / 100,
          /* Whether that price came from an invoice or from somebody's
             estimate. It travels with the number for the same reason it does
             on a recipe: an estimate presented as a measurement is worse than
             an admitted gap. */
          costEstimated: evidenceFor(basis, row.ingredientId).estimated,
        };
      });

      return res.status(200).json({
        branches,
        branchNames: Object.fromEntries(
          roster.filter((b) => branches.includes(String(b.id))).map((b) => [String(b.id), b.name])
        ),
        rows,
        policy: await getPolicy(orgId),
        types: MOVEMENT_KEYS,
        units: unitsByDimension(),
        canManage: may("manage:inventory"),
        /* Provenance, stage 3's rule applied here too: a total is meaningless
           without the scope it was computed over. */
        scope: { branchCount: branches.length, totalBranches: roster.length },
      });
    }

    if (req.method === "POST") {
      if (!may("manage:inventory")) return res.status(403).json({ error: "forbidden" });
      const body = req.body || {};

      if (what === "policy") {
        const policy = await savePolicy(orgId, body);
        await recordAudit(orgId, {
          actor: session.username, action: "stock.policy",
          detail: { allowNegative: policy.allowNegative },
        });
        return res.status(200).json({ policy });
      }

      if (what === "movement") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        /* The unit as written, read into the one the ledger keeps. Typed by
           hand here, so "Kg" and "كجم" arrive as often as "kg" does. */
        const typed = String(body.unit || "");
        const out = await recordMovement(orgId, branch[0], {
          ...body, unit: resolveUnit(typed).unit || typed, actor: session.username,
        });
        if (out.error === "negative") {
          return res.status(409).json({ error: out.error, onHand: out.onHand, short: out.short });
        }
        if (out.error) {
          return res.status(400).json({
            error: out.error === "unit" && isPackaging(typed) ? "packaging" : out.error,
            name: out.ingredientName || null,
            unit: typed || null,
            stockUnit: out.stockUnit || null,
          });
        }

        await recordAudit(orgId, {
          actor: session.username, action: "stock.movement", target: out.movement.ingredientId,
          detail: {
            type: out.movement.type, qty: out.movement.qty,
            unit: out.movement.unit, branchId: branch[0],
          },
        });
        return res.status(200).json({ movement: out.movement });
      }

      /* A whole delivery, received together.

         Same reasoning as the consume batch below: validated as a set, then
         written, so a dropped connection mid-invoice cannot leave the store
         holding half a delivery with nothing to say which half.

         A unit cost rides on each line. That is the point of scanning the note
         rather than counting the boxes — the price actually paid this week is
         what makes every recipe cost downstream true, and re-typing it from
         the same piece of paper is where it stops being true. */
      /* Bring the ledger up to date with sales.

         Called after a metrics refresh rather than on a timer, so it runs when
         somebody is looking at the numbers and never in the background against
         an account nobody is using. Idempotent by receipt id, so calling it
         twice in a minute does nothing the second time.

         Refuses when the setting is off rather than silently doing nothing, so
         a client that has not noticed gets told. */
      if (what === "deplete-sales") {
        const meta = await getMeta(orgId);
        if (!meta.autoDepleteFromSales) return res.status(409).json({ error: "disabled" });

        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        let receipts = [];
        try {
          receipts = await receiptsFor(await posTokenFor(session.username), branch[0]);
        } catch (err) {
          console.error("sales depletion could not read the till:", err?.message || err);
          return res.status(502).json({ error: "pos" });
        }

        const out = await depleteFromSales(orgId, branch[0], receipts, { actor: session.username });
        if (out.movements) {
          await recordAudit(orgId, {
            actor: session.username,
            action: "stock.autoDeplete",
            detail: { branchId: branch[0], receipts: out.posted, lines: out.movements },
          });
        }
        return res.status(200).json(out);
      }

      /* A whole scanned invoice, committed in one press.

         This replaces a sequence the browser used to run: create the
         ingredients that did not match, wait, re-attach the new ids onto the
         lines, then post the delivery. Three round trips, each able to fail on
         its own, with no way to finish the job from the state a failure left
         behind — the ingredients created and the delivery not received, and
         nothing on screen saying so.

         One call instead, doing the three things in the order they depend on:

         1. **Create what does not exist.** The parser has already described
            each unmatched line — a name, a unit, a pack size — so there is
            nothing to ask anybody.
         2. **Receive everything**, validated as a set before a single entry is
            written, so the common failure lands before the ledger moves.
         3. **Learn the vocabulary.** Every line that ended up against an
            ingredient teaches the alias table what this supplier calls it, so
            the next invoice resolves without being guessed at.

         Learning happens last and only on success. An invoice that was refused
         is not a decision about anything, and teaching the table from one would
         make a rejected guess permanent. */
      if (what === "invoice") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const rows = Array.isArray(body.lines) ? body.lines : [];
        if (!rows.length) return res.status(400).json({ error: "empty" });

        /* Lines the scan could not match, each carrying what to create. Built
           before anything is written so a malformed proposal fails here rather
           than halfway through. */
        const creating = rows.filter((r) => !r.ingredientId && r.newItem?.name);
        const made = new Map();

        for (const row of creating) {
          const out = await saveIngredient(orgId, {
            name: row.newItem.name,
            stockUnit: row.newItem.stockUnit,
            purchaseUnit: row.newItem.purchaseUnit,
            packSize: row.newItem.packSize,
            category: row.newItem.category || undefined,
          });
          /* A proposal the item master refuses is skipped rather than fatal:
             one unreadable line out of nine must not cost the other eight.
             The line is reported back unreceived. */
          if (out.error) continue;
          made.set(row.newItem.name.toLowerCase(), out.ingredient);
        }

        const resolved = rows.map((row) => {
          if (row.ingredientId) return row;
          const hit = row.newItem?.name ? made.get(row.newItem.name.toLowerCase()) : null;
          return hit ? { ...row, ingredientId: hit.id, unit: row.unit || hit.stockUnit } : row;
        });

        /* `receiveQty`/`receiveUnit` where the parser worked out the shelf's
           own unit, the printed pair otherwise. Never the printed quantity
           beside a restated cost — see the note in `_purchase.js`. */
        const qtyOf = (r) => Number(r.receiveQty ?? r.qty);
        /* Read rather than matched literally.

           The word arriving here is either what a supplier printed or what
           somebody typed to correct it, and neither comes out as a ledger key.
           "Kg", "L", "Pcs", "كجم" and "piraso" were all refused as "the unit
           of one of the lines does not suit that ingredient", every one of
           them a spelling `_unitwords.js` already knew.

           Spelling only: the number is untouched, so the unit cost that was
           quoted against it stays true. A word this still cannot place is left
           exactly as it came and refused by the ledger, which is the one place
           that should be strict about it. */
        const unitOf = (r) => {
          const printed = String(r.receiveUnit || r.unit || "");
          return resolveUnit(printed).unit || printed;
        };

        const receivable = resolved.filter((r) =>
          r.ingredientId && qtyOf(r) > 0 && unitOf(r));
        if (!receivable.length) return res.status(400).json({ error: "line" });

        const note = [body.supplier, body.invoiceNo].filter(Boolean).join(" · ").slice(0, 200);
        const prepared = receivable.map((r) => ({
          ingredientId: String(r.ingredientId),
          qty: qtyOf(r),
          unit: unitOf(r),
          unitCost: Number(r.unitCost) > 0 ? Number(r.unitCost) : undefined,
          type: "receive",
          ref: String(body.invoiceNo || "").slice(0, 60),
          note,
        }));

        /* One line the ledger will not take must not cost the other forty-seven.

           This used to answer 400 for the whole invoice on the first refusal,
           so a forty-eight-line delivery with one unplaceable unit received
           nothing at all — and the message named no line, which made finding it
           a hunt through the list. It also contradicted the rule this same
           handler follows two blocks up, where an ingredient the master refuses
           is skipped so that "one unreadable line out of nine must not cost the
           other eight".

           It was not atomic either: the write loop below breaks on the first
           error and leaves whatever it had already written. So the choice was
           never all-or-nothing — it was between a partial commit nobody was
           told about and a partial commit that says what it left behind. */
        const dry = await Promise.all(prepared.map((r) =>
          recordMovement(orgId, branch[0], { ...r, actor: session.username, dryRun: true })));

        const takeable = prepared.filter((_, i) => !dry[i].error);
        const refused = prepared
          .map((r, i) => (dry[i].error
            ? {
                ingredientId: r.ingredientId,
                name: dry[i].ingredientName || receivable[i]?.text || "",
                /* "3 SACK" and "pieces where kilos are kept" both reach the
                   ledger as `unit`, and only one of them is answerable by
                   choosing a different unit. Told apart here, where the word
                   is still in hand, so the screen can ask the right question. */
                reason: dry[i].error === "unit" && isPackaging(r.unit) ? "packaging" : dry[i].error,
                stockUnit: dry[i].stockUnit || "",
                /* What was actually on the line, so the screen can quote "3
                   SACK" back rather than saying "one of the lines". */
                qty: r.qty,
                unit: unitLabel(r.unit),
              }
            : null))
          .filter(Boolean);

        /* Nothing survived. The one case still worth a 400: there is no
           delivery to record, and the first reason is the whole story. */
        if (!takeable.length) {
          return res.status(400).json({ error: refused[0]?.reason || "line", refused });
        }

        /* Has this exact delivery already been received?

           The till path has always remembered which receipts it posted, so a
           retry deducts nothing twice. This path remembered nothing, so
           scanning one delivery note again received it again — in full, and
           silently, because a doubled balance looks exactly like a correct one.

           Asked rather than refused: two separate deliveries of the same things
           in the same amounts are possible, and only the person holding the
           paperwork knows. One tap either way, against a doubling nobody would
           otherwise catch. The dry run above has already told us exactly what
           would be written, so the question is asked before anything is. */
        const print = fingerprint(
          dry.filter((d) => d.movement).map((d) => d.movement),
        );
        if (!body.confirm) {
          const already = await findRepeat(orgId, branch[0], print);
          if (already) {
            return res.status(409).json({
              error: "duplicate",
              at: already.at,
              lines: already.lines,
              supplier: already.supplier,
              invoiceNo: already.invoiceNo,
            });
          }
        }

        const written = [];
        for (const r of takeable) {
          const out = await recordMovement(orgId, branch[0], { ...r, actor: session.username });
          if (out.error) break;
          written.push(out.movement);
        }

        /* Kept so this delivery can be taken back as one thing. Reversal was
           already per entry, which for forty-eight lines is forty-eight
           confirmations — an undo nobody would ever reach the end of. */
        const delivery = written.length
          ? await rememberInvoice(orgId, branch[0], {
              fingerprint: print,
              supplier: body.supplier,
              invoiceNo: body.invoiceNo,
              actor: session.username,
              movementIds: written.map((m) => m.id),
              lines: written.length,
            })
          : null;

        /* What this supplier calls each thing, remembered. Only for lines that
           were actually received, and only from their printed description. */
        const receivedIds = new Set(written.map((m) => m.ingredientId));
        const learned = await learnAliases(orgId, receivable
          .filter((r) => receivedIds.has(String(r.ingredientId)) && r.text)
          .map((r) => ({ text: r.text, ingredientId: String(r.ingredientId) })));

        await recordAudit(orgId, {
          actor: session.username,
          action: "stock.receive",
          detail: {
            branchId: branch[0],
            lines: written.length,
            created: made.size,
            invoiceNo: String(body.invoiceNo || ""),
            supplier: String(body.supplier || ""),
            source: "invoice",
          },
        });

        return res.status(200).json({
          movements: written,
          /* The handle for taking this delivery back, so the screen can offer an
             undo the moment it is most wanted — right after an accidental
             second scan. */
          deliveryId: delivery?.id || null,
          created: [...made.values()].map((i) => ({ id: i.id, name: i.name })),
          learned: learned.learned,
          /* Lines that could not be received at all, named rather than
             silently dropped — the count on screen has to be able to say
             "eight of nine". */
          skipped: resolved
            .filter((r) => !receivable.includes(r))
            .map((r) => r.text || r.newItem?.name || "")
            .filter(Boolean),
          /* Lines the ledger itself turned down, each with which one and why,
             so the screen can name them instead of reporting "the unit of one
             of the lines" about a delivery of forty-eight. */
          refused,
        });
      }

      if (what === "receive-batch") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const rows = Array.isArray(body.movements) ? body.movements : [];
        if (!rows.length) return res.status(400).json({ error: "empty" });

        const prepared = rows.map((row) => ({
          ingredientId: String(row.ingredientId || ""),
          qty: Number(row.qty),
          unit: resolveUnit(String(row.unit || "")).unit || String(row.unit || ""),
          unitCost: Number.isFinite(Number(row.unitCost)) && Number(row.unitCost) > 0
            ? Number(row.unitCost)
            : undefined,
          type: "receive",
          note: String(body.note || "").slice(0, 200),
        }));

        if (prepared.some((r) => !r.ingredientId || !(r.qty > 0) || !r.unit)) {
          return res.status(400).json({ error: "line" });
        }

        const dry = await Promise.all(prepared.map((r) =>
          recordMovement(orgId, branch[0], { ...r, actor: session.username, dryRun: true })));
        const refused = dry.find((d) => d.error);
        if (refused) {
          return res.status(400).json({
            error: refused.error,
            ingredientId: refused.ingredientId || null,
            ingredientName: refused.ingredientName || null,
          });
        }

        const written = [];
        for (const r of prepared) {
          const out = await recordMovement(orgId, branch[0], { ...r, actor: session.username });
          if (out.error) break;
          written.push(out.movement);
        }

        await recordAudit(orgId, {
          actor: session.username,
          action: "stock.receive",
          detail: { branchId: branch[0], lines: written.length, source: "supplierscan" },
        });

        return res.status(200).json({ movements: written });
      }

      /* A whole bill's consumption, committed together.

         The single-movement route would work in a loop from the browser, but a
         dropped connection halfway through a twelve-ingredient bill leaves the
         ledger holding part of a meal — and nothing on the screen or in the log
         would say which part. So the set is validated first and written only
         if every line passes.

         This is not a transaction; the store has no such thing. What it buys is
         that the common failure — one ingredient short, one unit mismatched — is
         caught before anything moves, rather than after five entries already
         have. */
      if (what === "consume") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const rows = Array.isArray(body.movements) ? body.movements : [];
        if (!rows.length) return res.status(400).json({ error: "empty" });

        const prepared = rows.map((row) => ({
          ingredientId: String(row.ingredientId || ""),
          qty: Number(row.qty),
          unit: resolveUnit(String(row.unit || "")).unit || String(row.unit || ""),
          type: "consume",
          note: String(body.note || "").slice(0, 200),
        }));

        if (prepared.some((r) => !r.ingredientId || !(r.qty > 0) || !r.unit)) {
          return res.status(400).json({ error: "line" });
        }

        const dry = await Promise.all(
          prepared.map((r) => recordMovement(orgId, branch[0], { ...r, actor: session.username, dryRun: true })),
        );
        const refused = dry.find((d) => d.error);
        if (refused) {
          return res.status(refused.error === "negative" ? 409 : 400).json({
            error: refused.error,
            ingredientId: refused.ingredientId || null,
            onHand: refused.onHand,
            short: refused.short,
          });
        }

        const written = [];
        for (const r of prepared) {
          const out = await recordMovement(orgId, branch[0], { ...r, actor: session.username });
          if (out.error) break;
          written.push(out.movement);
        }

        await recordAudit(orgId, {
          actor: session.username,
          action: "stock.consume",
          /* Automatic depletion from POS sales. Labelled "billscan" until the
             bill scanner was removed — this path never involved one, it reads
             the till. */
          detail: { branchId: branch[0], lines: written.length, source: "sales" },
        });

        return res.status(200).json({ movements: written });
      }

      if (what === "transfer") {
        /* Both ends are checked. A user authorized for one branch cannot push
           stock into — or pull it out of — a branch they can't see. */
        const from = permitted(body.fromBranchId);
        const to = permitted(body.toBranchId);
        if (!from.length || !to.length) return res.status(403).json({ error: "branch" });

        const out = await recordTransfer(orgId, {
          ...body, fromBranchId: from[0], toBranchId: to[0], actor: session.username,
        });
        if (out.error === "negative") {
          return res.status(409).json({ error: out.error, onHand: out.onHand, short: out.short });
        }
        if (out.error) return res.status(400).json({ error: out.error });

        await recordAudit(orgId, {
          actor: session.username, action: "stock.transfer", target: out.out.ingredientId,
          detail: { qty: Math.abs(out.out.qty), unit: out.out.unit, from: from[0], to: to[0] },
        });
        return res.status(200).json(out);
      }

      if (what === "reverse") {
        /* Undoing a movement is not the same permission as making one.

           Anyone who can post a count can post a wrong one, and that is fine —
           it leaves a trail, and the trail is the whole point of a ledger. What
           should not be the same permission is erasing the effect of a
           movement, because somebody who can both create and cancel entries can
           make a discrepancy disappear, and the leakage screen would show
           nothing wrong.

           The reversal still writes a compensating entry rather than deleting
           anything, so this is a restriction on who may cancel, not a change to
           how. Held with manage:users, which in practice means the owner: the
           person answerable for the numbers is the person who can unwind
           them. */
        if (!can(scope.role, "manage:users")) return res.status(403).json({ error: "notowner" });

        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const out = await reverseMovement(orgId, branch[0], String(body.id || ""), {
          actor: session.username, reason: body.reason,
        });
        if (out.error === "notfound") return res.status(404).json({ error: out.error });
        if (out.error) return res.status(409).json({ error: out.error });

        await recordAudit(orgId, {
          actor: session.username, action: "stock.reverse", target: out.movement.ingredientId,
          detail: { of: out.movement.reverses, type: out.movement.type, branchId: branch[0] },
        });
        return res.status(200).json(out);
      }

      /* Take back a whole delivery.

         Reversal has always been per entry, which is right for correcting one
         mistaken count — and useless for the mistake this actually gets made:
         scanning the same forty-eight line delivery note twice. Undoing that
         meant forty-eight confirmations, so in practice nobody undid it and the
         balance stayed doubled.

         Nothing new happens to the ledger. Every entry is reversed by the same
         function, one compensating entry each, and an entry already reversed is
         skipped rather than reversed twice. Same permission as a single
         reversal, for the same reason: unwinding is the owner's to do. */
      if (what === "undo-delivery") {
        if (!can(scope.role, "manage:users")) return res.status(403).json({ error: "notowner" });

        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const delivery = await getInvoice(orgId, branch[0], String(body.id || ""));
        if (!delivery) return res.status(404).json({ error: "notfound" });
        if (delivery.undone) return res.status(409).json({ error: "alreadyundone" });

        let reversed = 0;
        const refused = [];
        for (const id of delivery.movementIds) {
          const one = await reverseMovement(orgId, branch[0], id, {
            actor: session.username,
            reason: String(body.reason || "").slice(0, 200),
          });
          if (one.error) { refused.push({ id, error: one.error }); continue; }
          reversed += 1;
        }

        await markUndone(orgId, branch[0], delivery.id, { reversed });
        await recordAudit(orgId, {
          actor: session.username,
          action: "stock.undo-delivery",
          detail: {
            branchId: branch[0],
            delivery: delivery.id,
            supplier: delivery.supplier,
            invoiceNo: delivery.invoiceNo,
            reversed,
            /* Entries that could not be taken back — already reversed, or gone.
               Counted rather than hidden, so "43 of 47" is answerable. */
            refused: refused.length,
          },
        });

        return res.status(200).json({ reversed, refused, of: delivery.movementIds.length });
      }

      return res.status(400).json({ error: "what" });
    }

    /* No DELETE. The ledger is corrected by reversal, never removed — see
       `api/_movements.js`. */
    return res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    console.error("stock endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
