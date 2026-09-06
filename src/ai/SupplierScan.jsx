import { useState, useEffect } from "react";
import { Loader2, Check, Save, Trash2, FileText, AlertTriangle, ChevronDown } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import PhotoScan from "./PhotoScan.jsx";
import { unitNote, nameList } from "./unitnote.js";

/* A supplier invoice, photographed or uploaded, turned into stock.

   ── What this screen deliberately does not ask ─────────────────────────────

   It used to open a table: a dropdown per line to pick the ingredient, a text
   box for the unit, a number for the cost, and a mismatch warning when the
   invoice said kilos and the shelf said litres. Twelve lines of that, before a
   delivery could be received.

   Every one of those questions has an answer the system already holds or can
   work out. Which ingredient: the alias table remembers what this supplier
   called it last time, and the matcher handles the first time. What unit: read
   off the invoice and converted in `_units.js`, which is the only place that
   arithmetic is safe. What cost: the line total over the quantity, restated
   into the unit the shelf keeps — a figure derived, never typed, because the
   per-unit price printed on an invoice is rounded for display.

   So the screen asks nothing and states everything: the header a person would
   check on the paper itself — number, date, supplier, subtotal, VAT, total,
   how many lines — and two buttons. Save commits the delivery. Cancel throws
   the draft away without touching the database.

   The lines are still one press away, and still editable, because a scan can
   be wrong and the answer to that must never be "start again". They are just
   not the first thing anybody has to deal with. */

/* Which units this line may be written in.

   The ones that measure the same kind of thing as the shelf, because those are
   exactly the ones that convert — so a choice from this list can never produce
   the mismatch this screen spends its time reporting. Where the shelf is not
   known yet, because the line is creating its own ingredient, every unit is
   offered and the server decides. */
function unitChoices(units, line) {
  if (!units) return [];
  const all = [...(units.mass || []), ...(units.volume || []), ...(units.count || [])];
  const shelf = line.stocksIn || line.stockUnit || line.newItem?.stockUnit || "";
  if (!shelf) return all;
  for (const dimension of ["mass", "volume", "count"]) {
    const set = units[dimension] || [];
    if (set.some((u) => u.key === shelf)) return set;
  }
  return all;
}

/* What to call a unit on screen.

   The server sends the key and an English label; this prefers the reader's own
   word for it and falls back to the label. Somebody counting in حبة should not
   have to recognise "each" — and the value posted is the key either way, so
   nothing about the ledger depends on which language is being read. */
const unitName = (t, u) => t.unitNames?.[u.key] || u.label || u.key;

/* The server's refusal for one line, found by id or by name.

   A line whose ingredient the commit created has no id on this side, so id
   alone would fail to pair a refusal with the row it belongs to — which is the
   same reason the row was being dropped from the list entirely. */
function reasonFor(refused, line) {
  const id = String(line.ingredientId || "");
  const names = [line.ingredientName, line.newItem?.name, line.text]
    .filter(Boolean)
    .map((n) => String(n).trim().toLowerCase());
  return (refused || []).find((r) =>
    (id && String(r.ingredientId || "") === id)
    || names.includes(String(r.name || "").trim().toLowerCase())) || null;
}

/* One row of the invoice header. Dotted rule between, values ending the line,
   which is how the paper itself is laid out and how it reads in both
   directions. */
function Row({ label, children }) {
  const C = useC();
  return (
    <div className="flex items-center justify-between gap-4 py-2.5"
      style={{ borderBottom: `1px dashed ${C.hairline}` }}>
      <span className="text-xs shrink-0" style={{ color: C.slate }}>{label}</span>
      <span className="data text-sm font-semibold text-end">{children}</span>
    </div>
  );
}

export default function SupplierScan({ token, onReceived, initial, onInitialUsed }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.supplierscan;

  const [result, setResult] = useState(null);
  const [lines, setLines] = useState([]);
  const [stock, setStock] = useState([]);
  /* The units the ledger keeps, by dimension, straight from the server. The
     endpoint has always returned them and nothing here read them, which is why
     the unit was a text box somebody could type an unusable word into. */
  const [units, setUnits] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [review, setReview] = useState(false);

  useEffect(() => {
    if (!branch && branches.length) setBranch(branches[0].id);
  }, [branches, branch]);

  /* A document read elsewhere — dropped into Ask and sorted here — arrives
     already extracted. Consumed once, so navigating away and back does not
     re-open a delivery somebody already received. */
  useEffect(() => {
    if (!initial) return;
    open(initial);
    onInitialUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    fetch("/api/inventory", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { setStock(j?.ingredients || []); setUnits(j?.units || null); })
      .catch(() => {});

    fetch("/api/scope", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBranches(j?.branches || []))
      .catch(() => {});
  }, [token]);

  const open = (r) => {
    setResult(r);
    setNote("");
    setFailed(false);
    setReview(false);
    setLines((r?.lines || []).map((l) => ({ ...l })));
  };

  /* Throw the draft away. Nothing has been written at this point — the scan
     produced an object in this component and nowhere else — so there is nothing
     to undo and no confirmation to ask for. */
  const cancel = () => {
    setResult(null);
    setLines([]);
    setNote("");
    setFailed(false);
    setReview(false);
  };

  /* Editing a quantity or a unit by hand drops the parser's converted pair.

     `receiveQty`/`receiveUnit` are the parser's restatement of the line into
     the shelf's unit, and they are only consistent with `unitCost` as long as
     nobody has touched the figures they were derived from. Somebody typing a
     corrected quantity means the printed pair, so the converted one has to go
     rather than silently overriding what they just typed. */
  const edit = (i, patch) =>
    setLines((list) => list.map((l, n) => (n === i
      ? { ...l, ...patch, ...("qty" in patch || "unit" in patch
          ? { receiveQty: undefined, receiveUnit: undefined, edited: true } : {}) }
      : l)));
  const drop = (i) => setLines((list) => list.filter((_, n) => n !== i));

  /* Everything the delivery will do: lines that already match, plus lines the
     scan described well enough to create. Both are received; the difference is
     invisible from here and that is the point. */
  const willReceive = lines.filter((l) =>
    Number(l.qty) > 0 && (l.ingredientId || l.newItem?.name));

  /* Lines the ledger will not take as written, known before anybody presses
     anything.

     The scan already worked this out per line — it had to, to restate the
     costs — and it was the one thing it did not say. So a delivery of
     forty-eight was refused as a whole for one of them, and once the refusal
     became partial and named the ingredient, finding that ingredient still
     meant opening a closed list of forty-eight rows and reading down it.

     A line edited by hand clears the flag rather than keeping a stale one:
     `trouble` was computed against the unit the scan read, and somebody who
     has just retyped the unit is answering exactly this. The server checks
     again on save regardless — this is a signpost, never a gate. */
  const troubled = lines.filter((l) => l.trouble && !l.edited);

  const save = async () => {
    if (!branch && branches.length) { setFailed(true); setNote(s.pickBranch); return; }
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/stock?what=invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          branchId: branch || branches[0]?.id,
          supplier: result?.supplier || "",
          invoiceNo: result?.invoiceNo || "",
          lines: willReceive,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailed(true);
        setNote(json.error === "branch" ? s.pickBranch
          : json.error === "line" || json.error === "empty" ? s.errNothing
          : unitNote(s, json.refused?.[0]) || s.errServer);
        /* A refusal about a line is answered on that line, and the list is
           closed by default. Naming the ingredient and then leaving somebody
           to go and find it is half a message. */
        if (json.refused?.length) setReview(true);
        return;
      }

      setFailed(false);
      onReceived?.(json.movements || []);
      /* Some lines went in and some did not, which is now a possible outcome
         rather than an all-or-nothing refusal. Saying "took 46 of 48, left out
         Brioche buns" is the difference between knowing what to fix and
         wondering what happened to the delivery. */
      if (json.refused?.length) {
        setFailed(true);
        /* One refused line gets its reason, not just its name.

           "47 of 48 recorded. Not recorded: Grilling butter" says which line
           and nothing about what to do with it — the same half-message this
           screen kept producing in other forms. Where there is one, there is
           room to say why; where there are several, the count goes here and
           each row carries its own reason in the list below. */
        const why = json.refused.length === 1 ? unitNote(s, json.refused[0]) : "";
        setNote([
          fill(s.errPartly, {
            count: json.movements?.length || 0,
            total: (json.movements?.length || 0) + json.refused.length,
            names: nameList(json.refused.map((r) => r.name), lang) || "—",
          }),
          why,
        ].filter(Boolean).join(" "));

        /* The received lines are gone from the draft — they are in the ledger
           now, and leaving them on screen invites a second press and a doubled
           delivery. What stays is exactly what did not go in, open, so the
           remainder can be corrected and saved without scanning again.

           Matched by name as well as by id, because a line whose ingredient
           this commit created has no id on this side — the server made it. The
           id-only filter dropped exactly those lines, so somebody was told
           "Grilling butter was not recorded" and then handed an empty list to
           fix it in. */
        const ids = new Set(json.refused.map((r) => String(r.ingredientId || "")).filter(Boolean));
        const names = new Set(json.refused.map((r) => String(r.name || "").trim().toLowerCase()).filter(Boolean));
        const kept = lines.filter((l) => {
          if (l.ingredientId && ids.has(String(l.ingredientId))) return true;
          for (const candidate of [l.ingredientName, l.newItem?.name, l.text]) {
            if (candidate && names.has(String(candidate).trim().toLowerCase())) return true;
          }
          return false;
        });
        /* Nothing recognisable left to correct — better an empty screen than
           an empty list pretending to be one. */
        if (!kept.length) { setResult(null); setLines([]); return; }
        setLines(kept.map((l) => ({ ...l, refusedReason: reasonFor(json.refused, l) })));
        setReview(true);
        return;
      }
      /* Saved and gone. Leaving the card on screen after a successful commit
         invited pressing save again, and the only thing standing between that
         and a doubled delivery was somebody noticing. */
      setResult(null);
      setLines([]);
      setNote(fill(s.saved, {
        count: json.movements?.length || 0,
        created: json.created?.length || 0,
      }));
    } catch {
      setFailed(true);
      setNote(s.errServer);
    } finally {
      setBusy(false);
    }
  };

  const field = {
    className: "data text-xs rounded px-1.5 py-1 outline-none",
    style: { background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  const money = (n) => (n === null || n === undefined
    ? <span style={{ color: C.slate }}>—</span>
    : <Money value={n} decimals={2} />);

  return (
    <div className="space-y-4">
      {/* The way in. One control, both input modes — the camera for a paper
          delivery note, the file picker for the PDF a supplier emailed. */}
      <PhotoScan token={token} kind="supplier" buttonLabel={s.scan} onResult={open} />

      {note && !result && (
        <p className="text-xs flex items-center gap-1.5 px-1"
          style={{ color: failed ? C.rose : C.mint }}>
          {failed ? <AlertTriangle size={13} /> : <Check size={13} />} {note}
        </p>
      )}

      {result && (
        <div className="panel p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="display font-bold text-base flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg shrink-0"
                style={{ background: "var(--chip-bg)" }}>
                <FileText size={14} style={{ color: C.iris }} />
              </span>
              {s.extracted}
            </h3>
            {/* Ready, or ready with a caveat. The caveat is that the three
                printed totals do not add up, which means a figure was misread —
                worth saying before a delivery is committed on it, and not worth
                refusing over, because the lines may still be right. */}
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0"
              style={result.totalsAgree === false
                ? { background: "color-mix(in srgb, var(--amber) 14%, transparent)", color: C.amber }
                : { background: "color-mix(in srgb, var(--mint) 14%, transparent)", color: C.mint }}>
              {result.totalsAgree === false
                ? <><AlertTriangle size={12} /> {s.checkTotals}</>
                : <><Check size={12} /> {s.ready}</>}
            </span>
          </div>

          <div style={{ borderTop: `1px dashed ${C.hairline}` }}>
            <Row label={s.invoiceNo}>{result.invoiceNo || "—"}</Row>
            <Row label={s.invoiceDate}>{result.date || "—"}</Row>
            <Row label={s.supplier}>{result.supplier || "—"}</Row>
            <Row label={s.subtotal}>{money(result.subtotal)}</Row>
            <Row label={s.vat}>{money(result.tax)}</Row>
            <Row label={s.total}>{money(result.total)}</Row>
            <Row label={s.itemCount}>{fill(s.items, { n: willReceive.length })}</Row>
          </div>

          {branches.length > 1 && (
            <div className="mt-4">
              <label htmlFor="supbranch" className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
                style={{ color: C.slate }}>{s.branch}</label>
              <select id="supbranch" value={branch} onChange={(e) => setBranch(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Two actions, equal weight, both saying what they do. Cancel is not
              a quiet link beside a loud button: throwing away a scan is a
              reasonable thing to want and hiding it only produces deliveries
              nobody meant to receive. */}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <button type="button" onClick={cancel} disabled={busy}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{
                background: "color-mix(in srgb, var(--rose) 10%, transparent)",
                border: `1px solid color-mix(in srgb, var(--rose) 35%, transparent)`,
                color: C.rose,
              }}>
              <Trash2 size={15} /> {s.cancel}
            </button>

            <button type="button" onClick={save} disabled={busy || !willReceive.length}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{
                background: "color-mix(in srgb, var(--mint) 12%, transparent)",
                border: `1px solid color-mix(in srgb, var(--mint) 40%, transparent)`,
                color: C.mint,
              }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? s.saving : s.save}
            </button>
          </div>

          {note && (
            <p className="text-xs mt-3 flex items-center gap-1.5"
              style={{ color: failed ? C.rose : C.mint }}>
              {failed ? <AlertTriangle size={13} /> : <Check size={13} />} {note}
            </p>
          )}

          {/* Said before the press, not after it.

              Amber rather than red, and it opens the list rather than blocking
              the button: these lines do not stop the delivery — the rest go in
              regardless — they just will not go in themselves. Telling somebody
              afterwards that one of forty-eight lines was refused is telling
              them at the only moment they can do nothing about it. */}
          {troubled.length > 0 && !note && (
            <button type="button" onClick={() => setReview(true)}
              className="mt-3 w-full text-start text-xs flex items-start gap-1.5 rounded-lg px-3 py-2"
              style={{
                color: C.amber,
                background: "color-mix(in srgb, var(--amber) 10%, transparent)",
                border: `1px solid color-mix(in srgb, var(--amber) 30%, transparent)`,
              }}>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{fill(s.someWontFit, { n: troubled.length })}</span>
            </button>
          )}

          {/* Closed, and closed on purpose. The rows are almost always right,
              and opening twelve editable lines to confirm that is exactly the
              work this screen exists to remove. One press away for when it
              matters. */}
          <button type="button" onClick={() => setReview((v) => !v)}
            className="mt-4 text-xs font-semibold flex items-center gap-1"
            style={{ color: C.slate }}>
            <ChevronDown size={13} style={{
              transform: review ? "rotate(180deg)" : "none", transition: "transform .15s",
            }} />
            {review ? s.hideLines : fill(s.reviewLines, { n: lines.length })}
          </button>

          {review && (
            <div className="mt-3 space-y-1.5">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm flex-wrap"
                  style={{
                    background: "var(--chip-bg)",
                    /* The row that needs something, findable by scrolling
                       rather than by reading. A border on the leading edge
                       flips with the language on its own. */
                    ...(l.trouble && !l.edited
                      ? { borderInlineStart: `2px solid ${C.amber}` }
                      : {}),
                  }}>
                  <div className="flex-1 min-w-[9rem]">
                    <select
                      value={l.ingredientId || ""}
                      onChange={(e) => {
                        const ing = stock.find((x) => x.id === e.target.value);
                        edit(i, { ingredientId: e.target.value || null, stockUnit: ing?.stockUnit || null });
                      }}
                      aria-label={s.ingredient}
                      className="w-full bg-transparent font-medium outline-none text-sm"
                      style={{ color: C.ink }}
                    >
                      {/* Not "no match" any more. An unmatched line is a thing
                          to be created, and the scan has already said what — so
                          the option names it rather than reporting a failure. */}
                      <option value="">
                        {l.newItem?.name ? fill(s.willCreate, { name: l.newItem.name }) : s.noMatch}
                      </option>
                      {stock.map((ing) => (
                        <option key={ing.id} value={ing.id}>{ing.name}</option>
                      ))}
                    </select>
                    <div className="text-[11px] truncate" style={{ color: C.slate }}>
                      {l.text}
                      {l.viaAlias && <span className="ms-1" style={{ color: C.iris }}>· {s.remembered}</span>}
                    </div>
                    {/* Where the number came from.

                        A line reading "1 Carton" beside a cost of 0.002 looks
                        like a mistake unless the bracket the scan read off the
                        invoice is shown too. This is the arithmetic stated
                        back, in the supplier's own figures, so it can be
                        checked against the paper in a glance. */}
                    {l.pack && (
                      <div className="text-[11px] data" dir="ltr" style={{ color: C.cyan }}>
                        {fill(s.packRead, {
                          count: l.pack.count,
                          size: l.pack.size,
                          inner: l.pack.innerUnit,
                          total: l.pack.qty,
                          unit: l.pack.unit,
                        })}
                      </div>
                    )}

                    {/* What this row needs, in three or four words, next to the
                        box that fixes it. A package word is a different
                        question from a wrong dimension and gets asked as one. */}
                    {/* What the server actually said, where it has said
                        anything, and the scan's own guess otherwise. A refusal
                        that has already happened outranks a prediction of one:
                        it names the ingredient as the ledger knows it and the
                        unit it is really kept in, which is what the row needs
                        to be corrected against. */}
                    {l.refusedReason ? (
                      <div className="text-[11px] flex items-start gap-1" style={{ color: C.rose }}>
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        <span>{unitNote(s, l.refusedReason) || s.errServer}</span>
                      </div>
                    ) : l.trouble && !l.edited && (
                      <div className="text-[11px] flex items-center gap-1" style={{ color: C.amber }}>
                        <AlertTriangle size={11} className="shrink-0" />
                        {l.trouble === "packaging"
                          ? fill(s.rowPackAsk, { unit: l.printedUnit || l.unit })
                          : fill(s.rowKeptIn, { stockUnit: l.stocksIn || l.stockUnit })}
                      </div>
                    )}
                  </div>

                  <input type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={l.qty ?? ""} onChange={(e) => edit(i, { qty: e.target.value })}
                    aria-label={s.qty} {...field} style={{ ...field.style, width: "4.5rem", textAlign: "end" }} />

                  {/* A list, not a text box.

                      It was an input, so what got posted was whatever the scan
                      had printed or somebody had typed — "كجم (kg)", "Kg", a
                      word with a stray bracket. Those are all read correctly
                      now, but the better answer is not to produce them: the
                      option shows the label and the value stored is the
                      ledger's own key, so nothing unusable can leave this row.

                      Narrowed to the dimension the shelf is kept in, where
                      that is known. Offering kilograms for an ingredient
                      counted in pieces is offering the mistake this whole
                      screen keeps reporting; the units that remain are the
                      ones that convert, so choosing any of them is safe.

                      The scan's own word stays as an option when it is not one
                      of ours, so a line is never silently re-labelled by the
                      act of rendering it. */}
                  <select value={l.unit || ""} onChange={(e) => edit(i, { unit: e.target.value })}
                    aria-label={s.unit} {...field}
                    style={{ ...field.style, width: "5rem" }} dir="ltr">
                    {!unitChoices(units, l).some((u) => u.key === (l.unit || "")) && (
                      <option value={l.unit || ""}>{l.unit || "—"}</option>
                    )}
                    {unitChoices(units, l).map((u) => (
                      <option key={u.key} value={u.key}>{unitName(t, u)}</option>
                    ))}
                  </select>

                  <input type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={l.unitCost ?? ""} onChange={(e) => edit(i, { unitCost: Number(e.target.value) })}
                    aria-label={s.unitCost} {...field} style={{ ...field.style, width: "5rem", textAlign: "end" }} />

                  <button type="button" onClick={() => drop(i)} aria-label={s.remove}
                    className="shrink-0 p-1 rounded" style={{ color: C.slate }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <p className="text-[11px] pt-1" style={{ color: C.slate }}>{s.editHint}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
