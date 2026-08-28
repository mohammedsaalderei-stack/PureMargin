import { useState } from "react";
import { Plus, Loader2, Check, Trash2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Creating the ingredients a scan could not match.

   The scanners could only ever match against a master somebody had already
   typed, which is backwards: the reason to photograph a delivery note is that
   you have not typed it. A first-time user scanned an invoice, matched
   nothing, and was sent to a form — the work the feature exists to remove.

   The unit is the one thing the photograph cannot settle. An invoice saying
   "OLIVE OIL 5L TIN" has told you it comes in tins and not what the shelf
   counts in, and guessing litres would put a number in the master that every
   recipe cost afterwards is built on. So the unit is a choice, prefilled with
   the likeliest reading and never assumed.

   Names already in use are refused rather than merged. A scan reading "TOMATO"
   when the shelf says "Tomatoes" must not quietly redefine the ingredient
   every existing recipe points at. */

/* The units a delivery note actually speaks in, in the order somebody scanning
   one is likely to want them. */
const COMMON = ["kg", "g", "l", "ml", "ea"];

/* What a supplier's packaging word most likely means on the shelf. A tin of
   oil is litres; a sack of onions is kilos. Only a starting point — the person
   confirms. */
const HINT = {
  kg: "kg", g: "g", l: "l", ml: "ml",
  tin: "l", bottle: "l", carton: "l",
  sack: "kg", bag: "kg", box: "kg", crate: "kg",
  tub: "kg", pkt: "kg", pack: "kg",
  pcs: "ea", ea: "ea", each: "ea", unit: "ea", dozen: "ea",
};

export function guessUnit(invoiceUnit) {
  return HINT[String(invoiceUnit || "").trim().toLowerCase()] || "kg";
}

/* A supplier description is not an ingredient name. "TOMATOES RED GRADE A
   5KG BOX" names a delivery; the shelf wants "Tomatoes red". Strip the
   packaging and the sizes, keep the first few words, and let somebody fix it —
   a shorter wrong name is easier to correct than a long one. */
/* Matched the way the server matches, so the screen and the endpoint agree on
   what counts as the same name. */
export const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

export function cleanName(text) {
  const words = String(text || "")
    .replace(/\d+\s*(kg|g|l|ml|ea|pcs|x)\b/gi, " ")
    .replace(/\b(box|sack|bag|crate|tin|tub|pkt|pack|bottle|carton|case|grade|fresh|frozen)\b/gi, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  if (!words.length) return "";
  const joined = words.join(" ").toLowerCase();
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export default function NewIngredients({ token, seeds = [], existing = [], units = COMMON, onCreated }) {
  const C = useC();
  const { t } = useLang();
  const s = t.newingredients;

  /* Anything already on file is dropped before it is ever offered.

     Offering it and then failing on save was the old behaviour, and it put the
     work back on the person: they had to read an error, find the offending
     row, delete it, and save again — for a name the software already knew it
     had. A scan reading names off a delivery note will always turn up some
     that exist; that is the normal case, not a mistake to report. */
  const [rows, setRows] = useState(() => {
    const have = new Set(existing.map((i) => norm(i.name)));
    const seen = new Set();
    return seeds
      .map((seed) => ({
        name: cleanName(seed.text || seed.name || ""),
        stockUnit: guessUnit(seed.unit),
        from: seed.text || seed.name || "",
      }))
      .filter((r) => {
        if (!r.name) return false;
        const key = norm(r.name);
        /* Two lines of one invoice often name the same thing. */
        if (have.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  if (!rows.length || done) return null;

  const edit = (i, patch) => setRows((l) => l.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const drop = (i) => setRows((l) => l.filter((_, n) => n !== i));

  const usable = rows.filter((r) => r.name.trim() && r.stockUnit);

  const create = async () => {
    setBusy(true); setNote("");
    try {
      const res = await fetch("/api/inventory?what=ingredients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          source: "scan",
          ingredients: usable.map((r) => ({ name: r.name.trim(), stockUnit: r.stockUnit })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFailed(true);
        setNote(json.error === "stockUnit" ? s.errUnit : s.errServer);
        return;
      }
      setFailed(false);
      setDone(true);
      /* A skip is worth mentioning but is not a failure: it means the
         ingredient was already there, which is the outcome somebody wanted. */
      const made = json.ingredients?.length || 0;
      const skipped = json.skipped?.length || 0;
      setNote(skipped
        ? `${fill(s.done, { count: made })} ${fill(s.skipped, { count: skipped })}`
        : fill(s.done, { count: made }));
      onCreated?.(json.ingredients || []);
    } catch {
      setFailed(true);
      setNote(s.errServer);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl p-4" style={{ border: `1px dashed ${C.hairline}` }}>
      <h4 className="text-sm font-bold mb-1 flex items-center gap-2">
        <Plus size={14} style={{ color: C.iris }} /> {s.title}
      </h4>
      <p className="text-xs mb-3" style={{ color: C.slate }}>{s.lead}</p>

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm"
            style={{ background: "var(--chip-bg)" }}>
            <div className="flex-1 min-w-0">
              <input
                value={r.name}
                onChange={(e) => edit(i, { name: e.target.value })}
                aria-label={s.name}
                className="w-full bg-transparent font-medium outline-none text-sm"
                style={{ color: C.ink }}
              />
              <div className="text-[11px] truncate" style={{ color: C.slate }}>{r.from}</div>
            </div>
            <select
              value={r.stockUnit}
              onChange={(e) => edit(i, { stockUnit: e.target.value })}
              aria-label={s.unit}
              className="data text-xs rounded px-1.5 py-1 outline-none shrink-0"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}
            >
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <button type="button" onClick={() => drop(i)} aria-label={s.remove}
              className="shrink-0 p-1 rounded" style={{ color: C.slate }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.unitHint}</p>

      {note && (
        <p className="text-xs mt-3 flex items-center gap-1" style={{ color: failed ? C.rose : C.cyan }}>
          {!failed && <Check size={13} />} {note}
        </p>
      )}

      <button type="button" onClick={create} disabled={busy || !usable.length}
        className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
        style={{ background: C.iris, color: C.onPrimary }}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        {busy ? s.saving : fill(s.create, { count: usable.length })}
      </button>
    </div>
  );
}
