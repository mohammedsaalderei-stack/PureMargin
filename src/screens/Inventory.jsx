import { useEffect, useState } from "react";
import { Trash2, RotateCcw, Package, Pencil, ChevronDown, Settings2 } from "lucide-react";
import IngredientForm from "../inventory/IngredientForm.jsx";
import SupplierList from "../inventory/SupplierList.jsx";
import StockPanel from "../inventory/StockPanel.jsx";
import PurchasingPanel from "../purchasing/PurchasingPanel.jsx";
import SupplierScan from "../ai/SupplierScan.jsx";
import IngredientIcon from "../inventory/IngredientIcon.jsx";
import StockSource from "../inventory/StockSource.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Inventory: a way in, and what is on the shelf.

   ── What this screen is now ────────────────────────────────────────────────

   Two things, in the order somebody uses them. A button that photographs or
   uploads a supplier invoice, and the resulting stock. Everything else — the
   item master, suppliers, settings, the manual ledger entry — is real, still
   here, and folded away behind one control, because it is what you reach for
   when something has gone wrong rather than what you do on a Tuesday.

   It used to be seven panels stacked down the page with equal weight: the
   source switch, the depletion switch, the scanner, the item list, the
   balances, the count sheet, purchasing, suppliers. Every one of them was
   reasonable on its own and the sum was a screen nobody could see the point
   of. The point is: invoices in, sales out, this is what you have.

   ── What is gone ───────────────────────────────────────────────────────────

   The stock count. Opening a sheet, typing what is on each shelf, submitting
   it for somebody else to approve, and having the difference written into the
   ledger as an adjustment. It was a faithful implementation of how stock
   control is done on paper, and it asked a restaurant to do the single most
   tedious job in the building on a schedule, for a number this system can
   derive: deliveries in, minus what the sales consumed.

   ── What has not changed ───────────────────────────────────────────────────

   There is still no editable "quantity on hand" anywhere. Every balance in
   `StockPanel` is the sum of the ledger beneath it, and the only way to change
   one is to record another entry — including the reversal that corrects a
   mistake. An editable field here would be a second version of a derived
   number, and the two would disagree within a week.

   Reading needs `view:inventory`, editing needs `manage:inventory`. The server
   enforces both, so a viewer simply sees no buttons rather than buttons that
   fail. */

function Panel({ title, note, action, children }) {
  const C = useC();
  return (
    <div className="panel p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="display font-bold text-base">{title}</h3>
          {note && <p className="text-xs mt-1" style={{ color: C.slate }}>{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function Inventory({ token, pendingDoc, onDocUsed }) {
  const C = useC();
  const { t } = useLang();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [stockKey, setStockKey] = useState(0);
  const [managing, setManaging] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    try {
      const res = await fetch(`/api/inventory${showArchived ? "?archived=1" : ""}`, { headers: auth });
      if (res.status === 403) { setError(t.inventory.forbidden); return; }
      if (!res.ok) { setError(t.inventory.failed); return; }
      setError("");
      setState(await res.json());
    } catch {
      setError(t.inventory.failed);
    }
  }

  /* Saved straight through rather than staged behind a Save button: it is one
     switch, and a switch that needs confirming is a switch people leave alone. */
  async function saveAuto(on) {
    try {
      await fetch("/api/inventory?what=meta", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ autoDepleteFromSales: on }),
      });
      await load();
    } catch { /* the next load will show what actually stuck */ }
  }


  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const canManage = state?.canManage;

  async function save(record) {
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/inventory?what=ingredient", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const out = await res.json();
      if (!res.ok) {
        /* The server answers with the field that was wrong; the wording is ours,
           in the user's language. */
        setFormError(t.inventory.errors[out.error] || t.inventory.failed);
        return;
      }
      setAdding(false);
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  /* Clear the whole store.

     The scanners made this necessary. Somebody points a camera at three
     invoices to see what happens, ends up with forty half-right ingredients,
     and wants the shelf clear — not forty confirmations. Guarded by typing,
     because it takes the ledger with it and there is no undo. */
  async function resetAll() {
    /* Matched loosely on purpose. The word is translated, so somebody reading
       Arabic is asked for an Arabic word, and demanding exact case on top of
       that turns a confirmation into a spelling test. Trimmed and folded — the
       point of the prompt is that it cannot happen by accident, not that it is
       hard. */
    const typed = window.prompt(t.inventory.resetPrompt);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== t.inventory.resetWord.trim().toLowerCase()) {
      setFormError(t.inventory.resetMismatch);
      return;
    }

    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/inventory?what=all", { method: "DELETE", headers: auth });
      /* Checked, because it was not before: a refusal came back as a quiet 403
         and the screen carried on as though the store had been cleared. */
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setFormError(json.error === "notowner" ? t.inventory.resetOwnerOnly : t.inventory.failed);
        return;
      }
      await load();
    } catch {
      setFormError(t.inventory.failed);
    } finally {
      setBusy(false);
    }
  }

  /* Removing one row.

     Confirmed by name rather than a bare "are you sure", because the rows are
     small and adjacent and the wrong one is easy to hit. The server decides
     between removing and archiving — it can see the ledger and this screen
     cannot — and says which it did, so the message afterwards is the truth
     rather than a guess. */
  async function remove(id, name) {
    if (!window.confirm(fill(t.inventory.removeConfirm, { name }))) return;
    return archive(id);
  }

  async function archive(id) {
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory?what=ingredient&id=${encodeURIComponent(id)}`,
        { method: "DELETE", headers: auth });
      const json = await res.json().catch(() => ({}));
      /* Removed outright when nothing pointed at it, archived when the ledger
         did. Saying which avoids the "I deleted it and it is still there"
         confusion that archiving alone produces. */
      if (json.archived) setFormError(t.inventory.archivedInstead);
      await load();
    } finally { setBusy(false); }
  }

  async function restore(id) {
    setBusy(true);
    try {
      await fetch("/api/inventory?what=restore", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      await load();
    } finally { setBusy(false); }
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <p className="text-sm text-center" style={{ color: C.slate }}>{error}</p>
      </div>
    );
  }

  const ingredients = state?.ingredients || [];
  const unitLabel = (key) => {
    for (const d of ["mass", "volume", "count"]) {
      const hit = (state?.units?.[d] || []).find((u) => u.key === key);
      if (hit) return hit.label;
    }
    return key;
  };
  const supplierName = (id) => (state?.suppliers || []).find((s) => s.id === id)?.name || "—";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <div>
          <h2 className="display text-2xl md:text-3xl font-bold grad-text">{t.inventory.title}</h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{t.inventory.lead}</p>
        </div>

        {/* The way in, and the only one that matters day to day: photograph the
            delivery note, or upload the PDF the supplier emailed. */}
        <SupplierScan
          token={token}
          initial={pendingDoc?.scanner === "supplier" ? pendingDoc.data : null}
          onInitialUsed={onDocUsed}
          onReceived={() => { setStockKey((n) => n + 1); load(); }}
        />

        {/* What is on the shelf, which is what somebody opened this screen to
            see. Directly under the button that changes it. */}
        <StockPanel key={`stock-${stockKey}`} token={token} ingredients={ingredients} />

        {/* Everything else, behind one control.

            None of it is deprecated and none of it is hidden to make the screen
            look tidier — the item master is how a mis-scanned name gets fixed,
            and suppliers and the settings are load-bearing. It is folded
            because reaching for it means something needs correcting, and
            putting the correction tools at the same weight as the daily job
            made the daily job hard to find. */}
        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl text-sm font-semibold"
          style={{ background: "var(--chip-bg)", color: C.slate }}
        >
          <span className="flex items-center gap-2">
            <Settings2 size={15} /> {t.inventory.manage}
          </span>
          <ChevronDown size={15} style={{
            transform: managing ? "rotate(180deg)" : "none", transition: "transform .15s",
          }} />
        </button>

        {managing && (
        <>
        {/* Which side keeps the stock. Above the depletion switch because it
            decides whether that switch applies at all. */}
        {canManage && <StockSource token={token} meta={state?.meta} onChanged={load} />}

        {/* The one setting on this screen that changes what another screen
            means, so the consequence is stated rather than linked to. */}
        {state?.meta?.stockSource !== "pos" && (
        <section className="rounded-2xl border p-5" style={{ borderColor: C.hairline }}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={state?.meta?.autoDepleteFromSales !== false}
              onChange={(e) => saveAuto(e.target.checked)}
            />
            <span>
              <span className="text-sm font-bold">{t.inventory.autoDeplete}</span>
              <span className="block text-xs mt-1" style={{ color: C.slate }}>
                {t.inventory.autoDepleteHint}
              </span>
              <span className="block text-xs mt-2" style={{ color: C.slate }}>
                {state?.meta?.autoDepleteFromSales === false
                  ? t.inventory.autoDepleteOff
                  : t.inventory.autoDepleteOn}
              </span>
            </span>
          </label>
        </section>
        )}

        {(adding || editing) && (
          <Panel title={editing ? t.inventory.editTitle : t.inventory.addTitle}
            note={editing ? fill(t.inventory.editNote, { name: editing.name }) : t.inventory.addNote}>
            <IngredientForm
              editing={editing}
              units={state?.units}
              suppliers={state?.suppliers}
              meta={state?.meta}
              busy={busy}
              error={formError}
              onSave={save}
              onCancel={() => { setAdding(false); setEditing(null); setFormError(""); }}
            />
          </Panel>
        )}

        <Panel
          title={t.inventory.itemsTitle}
          note={fill(t.inventory.itemsNote, { n: ingredients.length })}
          /* No "add by hand" button any more. The way into this list is a
             photograph or a PDF: the scanner reads a delivery note, decides
             the name, the unit and the pack size, and creates everything in
             one press. A blank form beside that is a slower path to a worse
             answer, and offering both invited people down the slow one.

             Editing an existing row is untouched — the scanner is how things
             arrive, not the only way they can ever be corrected. */
        >
          {ingredients.length === 0 ? (
            <div className="text-center py-8">
              <Package size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
              <p className="text-sm" style={{ color: C.slate }}>{t.inventory.empty}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {ingredients.map((ing) => (
                <div key={ing.id} className="flex items-center gap-3 p-3 rounded-lg"
                  style={{ background: "var(--chip-bg)", opacity: ing.archived ? 0.55 : 1 }}>
                  {/* Something for the eye to catch on. Forty names in a column
                      are a wall of text; a picture per row makes scanning for
                      the tomatoes a glance rather than a read. */}
                  <IngredientIcon name={ing.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate-safe">{ing.name}</span>
                      {ing.archived && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.hairline, color: C.slate }}>
                          {t.inventory.archived}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                      {[
                        ing.category,
                        /* The pack relationship in words, because it is the fact
                           most likely to be wrong and hardest to spot. */
                        ing.packSize > 1 || ing.purchaseUnit !== ing.stockUnit
                          ? `${ing.packSize} ${unitLabel(ing.purchaseUnit)} → ${unitLabel(ing.stockUnit)}`
                          : unitLabel(ing.stockUnit),
                        ing.supplierId ? supplierName(ing.supplierId) : null,
                        ing.location,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      {!ing.archived && (
                        <button onClick={() => { setEditing(ing); setAdding(false); }} title={t.inventory.edit}
                          className="p-2 rounded-lg hover-soft" style={{ color: C.slate }}>
                          <Pencil size={14} />
                        </button>
                      )}
                      {ing.archived ? (
                        <button onClick={() => restore(ing.id)} disabled={busy} title={t.inventory.restore}
                          className="p-2 rounded-lg hover-soft" style={{ color: C.iris }}>
                          <RotateCcw size={14} />
                        </button>
                      ) : (
                        /* A bin, not an archive box. The endpoint removes the
                           ingredient outright when nothing points at it and
                           only falls back to archiving when the ledger does —
                           but the button said "archive" either way, so
                           somebody looking for a way to delete a mis-scanned
                           row found nothing that admitted to deleting. */
                        <button onClick={() => remove(ing.id, ing.name)} disabled={busy}
                          title={t.inventory.remove}
                          className="p-2 rounded-lg hover-soft" style={{ color: C.rose }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 mt-4 text-xs" style={{ color: C.slate }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}
              style={{ accentColor: C.iris }} />
            {t.inventory.showArchived}
          </label>

          {canManage && ingredients.length > 0 && (
            <div className="mt-4 pt-3 flex items-center justify-between gap-3 flex-wrap"
              style={{ borderTop: `1px solid ${C.hairline}` }}>
              <span className="text-[11px]" style={{ color: C.slate }}>
                {t.inventory.resetHint}
              </span>
              <button
                type="button"
                onClick={resetAll}
                className="text-xs font-semibold shrink-0"
                style={{ color: C.rose }}
              >
                {t.inventory.resetAll}
              </button>
            </div>
          )}
        </Panel>

        {/* Receiving writes movements, so the balances above re-read. */}
        <PurchasingPanel token={token} onStockChanged={() => setStockKey((n) => n + 1)} />

        <SupplierList
          token={token}
          suppliers={state?.suppliers || []}
          canManage={canManage}
          onChanged={load}
        />
        </>
        )}
      </div>
    </div>
  );
}
