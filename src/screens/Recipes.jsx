import { useEffect, useState } from "react";
import { Plus, ChefHat, AlertTriangle } from "lucide-react";
import RecipeForm from "../recipes/RecipeForm.jsx";
import RecipeSheet from "../recipes/RecipeSheet.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import RecipeScan from "../ai/RecipeScan.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* Recipes and what they cost — stage 4, phase 5.

   The screen's premise: a recipe is shared master data, but its cost is local,
   because it comes from the deliveries the authorized branches actually received.
   So the list is the same for everyone and the money on it isn't.

   The cost basis is a control at the top rather than a setting buried elsewhere.
   Weighted average and last cost are both legitimate and answer different
   questions, so the screen makes the choice visible and says what each one is
   for — a single unlabelled "cost" column is how a food-cost argument starts. */

export default function Recipes({ token, pendingDoc, onDocUsed }) {
  const C = useC();
  const { t } = useLang();
  const s = t.recipes;

  const [state, setState] = useState(null);
  const [method, setMethod] = useState("wavg");
  const [meta, setMeta] = useState(null);
  const [editing, setEditing] = useState(null);   // { recipe } | { recipe: null }
  const [openId, setOpenId] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState([]);

  const auth = { Authorization: `Bearer ${token}` };

  async function load(nextMethod = method) {
    const res = await fetch(`/api/recipes?method=${nextMethod}`, { headers: auth });
    if (res.ok) setState(await res.json());
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The sheet needs the full recipe — versions and priced lines — which the list
     deliberately doesn't carry. */
  async function openRecipe(id, nextMethod = method) {
    const res = await fetch(`/api/recipes?what=recipe&id=${encodeURIComponent(id)}&method=${nextMethod}`, { headers: auth });
    if (!res.ok) { setError(s.errors.failed); return null; }
    const json = await res.json();
    setOpen(json.recipe);
    setOpenId(id);
    return json.recipe;
  }

  async function startEditing(recipe) {
    const res = await fetch("/api/recipes?what=meta", { headers: auth });
    if (!res.ok) { setError(s.errors.failed); return; }
    setMeta(await res.json());
    setEditing({ recipe });
    setError("");
  }

  async function save(body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/recipes?what=save", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) { setError(s.errors[out.error] || s.errors.failed); return; }
      setEditing(null);
      await load();
      setOpen(out.recipe);
      setOpenId(out.recipe.id);
      /* Ingredients the save created, named. Writing a recipe adding rows to
         the shared item master is the feature working, but a system that does
         it without saying so is doing things behind somebody's back. */
      setCreated(out.newIngredients?.map((i) => i.name) || []);
    } catch {
      setError(s.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  async function archive(id, archived) {
    await fetch("/api/recipes?what=archive", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id, archived }),
    });
    await load();
    await openRecipe(id);
  }

  async function switchMethod(next) {
    setMethod(next);
    await load(next);
    if (openId) await openRecipe(openId, next);
  }

  if (!state) return null;

  const recipes = state.recipes || [];

  return (
    <div className="h-full overflow-y-auto">
      {/* The shell's <main> is overflow-hidden, so every screen owns its own
          scroll container. Five did not, which was survivable while their
          content happened to fit and stopped being survivable the moment a
          scanner added a result panel below the fold — the page simply ended
          and there was no way to reach the save button. */}
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
        <div>
          <h2 className="display font-bold text-xl">{s.title}</h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
        </div>

        {/* Photographing a card is the fastest route from nothing to a costed
            menu, so it sits above the list rather than behind it — on a new
            account the list is empty and this is the only thing worth doing. */}
        <RecipeScan token={token} onSaved={load}
        initial={pendingDoc?.scanner === "recipe" ? pendingDoc.data : null}
        onInitialUsed={onDocUsed} />

        {/* The basis every figure below was produced with. */}
        <div className="panel p-4">
          <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.costMethod}</div>
          <div className="flex gap-2">
            {["wavg", "last"].map((id) => (
              <button key={id} onClick={() => switchMethod(id)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={method === id
                  ? { background: C.iris, color: C.onPrimary }
                  : { border: `1px solid ${C.hairline}`, color: C.slate }}>
                {s.methods[id]}
              </button>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.methodHint[method]}</p>
        </div>

        {editing ? (
          <RecipeForm meta={meta} recipe={editing.recipe} busy={busy} error={error}
            onSave={save} onCancel={() => { setEditing(null); setError(""); }} />
        ) : (
          <div className="panel p-5 md:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="display font-bold text-base">{s.title}</h3>
              {state.canManage && (
                <button onClick={() => startEditing(null)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                  style={{ background: C.iris, color: C.onPrimary }}>
                  <Plus size={14} /> {s.newRecipe}
                </button>
              )}
            </div>

            {error && <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>}

            {created.length > 0 && (
              <p className="text-xs mb-3" style={{ color: C.iris }}>
                {fill(s.createdIngredients, { names: created.join(", ") })}
              </p>
            )}

            {recipes.length === 0 ? (
              <div className="text-center py-8">
                <ChefHat size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
                <p className="text-sm" style={{ color: C.slate }}>{s.empty}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {recipes.map((recipe) => (
                  <button key={recipe.id}
                    onClick={() => (openId === recipe.id ? (setOpenId(null), setOpen(null)) : openRecipe(recipe.id))}
                    className="w-full flex items-center gap-3 p-3 rounded-lg text-start"
                    style={{
                      background: "var(--chip-bg)",
                      border: `1px solid ${openId === recipe.id ? C.iris : "transparent"}`,
                    }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate-safe">{recipe.menuItem}</span>
                        {!recipe.complete && (
                          <AlertTriangle size={12} className="shrink-0" style={{ color: C.rose }} />
                        )}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                        {[
                          recipe.category,
                          fill(s.version, { n: recipe.version }),
                          recipe.margin ? `${recipe.margin.costPct}% ${s.costPct}` : null,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="text-sm font-bold shrink-0 inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
                      <DirhamMark />
                      {(recipe.perPortion?.total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {open && !editing && (
          <RecipeSheet token={token} recipe={open} method={method} canManage={state.canManage}
            onClose={() => { setOpen(null); setOpenId(null); }}
            onEdit={() => startEditing(open)}
            onDelete={async () => {
              if (!window.confirm(fill(t.recipes.deleteConfirm, { name: open.menuItem }))) return;
              try {
                await fetch(`/api/recipes?id=${encodeURIComponent(open.id)}`,
                  { method: "DELETE", headers: auth });
                setOpen(null);
                await load();
              } catch { /* the list reloads either way */ }
            }}
            onArchive={(archived) => archive(open.id, archived)} />
        )}
      </div>
    </div>
  );
}
