import { useEffect, useState } from "react";
import { Plus, Trash2, RotateCcw, Package, Truck, Pencil } from "lucide-react";
import IngredientForm from "../inventory/IngredientForm.jsx";
import SupplierList from "../inventory/SupplierList.jsx";
import StockPanel from "../inventory/StockPanel.jsx";
import CountsPanel from "../inventory/CountsPanel.jsx";
import PurchasingPanel from "../purchasing/PurchasingPanel.jsx";
import SupplierScan from "../ai/SupplierScan.jsx";
import IngredientIcon from "../inventory/IngredientIcon.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Inventory: the item master, and the stock that moves through it.

   Phase 1 is the definitions — ingredients, units, suppliers. Phase 2 adds the
   movement ledger, which is where quantities live. Phase 3 adds stock counts,
   which is where the ledger is confronted with the shelf. Phase 4 adds
   purchasing, which is where cost enters the system.

   There is still no editable "quantity on hand" anywhere on this screen. Every
   balance in `StockPanel` is the sum of the ledger beneath it, and the only way
   to change one is to record another entry — including the reversal that
   corrects a mistake. An editable field here would be a second version of a
   derived number, and the two would disagree within a week.

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
    if (window.prompt(t.inventory.resetPrompt) !== t.inventory.resetWord) return;
    try {
      await fetch("/api/inventory?what=all", { method: "DELETE", headers: auth });
      await load();
    } catch { setFormError(t.inventory.failed); }
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

        {/* AI stock reading — photo in, suggested list out. */}
        {/* The shelf scanner used to sit here beside this one, and it was the
            wrong offer in the wrong place: photographing a shelf produces
            estimates, and estimates do not belong in a master that every
            recipe cost is built on. Counting a shelf is what the count sheet
            is for, where two people sign off on the number.

            What belongs here is the paperwork a delivery actually arrives
            with. A PDF invoice from a supplier is a perfect record of what was
            bought and what it cost — better than any photograph of the shelf
            it ended up on. */}
        {/* The one setting on this screen that changes what another screen
            means, so the consequence is stated rather than linked to. */}
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

        <SupplierScan
          token={token}
          initial={pendingDoc?.scanner === "supplier" ? pendingDoc.data : null}
          onInitialUsed={onDocUsed}
        />

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

        <StockPanel key={`stock-${stockKey}`} token={token} ingredients={ingredients} />

        {/* Approving a count writes adjustments, so the balances above have to
            be re-read when one lands. */}
        <CountsPanel token={token} onStockChanged={() => setStockKey((n) => n + 1)} />

        {/* Receiving writes movements too, so the balances above re-read. */}
        <PurchasingPanel token={token} onStockChanged={() => setStockKey((n) => n + 1)} />

        <SupplierList
          token={token}
          suppliers={state?.suppliers || []}
          canManage={canManage}
          onChanged={load}
        />

        <p className="text-[11px] text-center pb-2" style={{ color: C.slate }}>
          <Truck size={11} className="inline me-1" />
          {t.inventory.nextPhase}
        </p>
      </div>
    </div>
  );
}
