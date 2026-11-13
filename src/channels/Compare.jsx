/* The comparison: one item across every channel, or the whole menu on one.

   Every figure is worked out here, by the same code the server costs an
   order with (`shared/channelmath.js`), so a price typed into a box shows
   what it would leave before anything is saved. Prices typed or suggested
   are a draft until Apply is pressed; nothing reaches a channel's price list
   by accident. */

import { useMemo, useState } from "react";
import { Wand2, Check, Copy, Download, Loader2, X } from "lucide-react";
import { fill } from "../i18n.jsx";
import { IN_STORE_ID } from "../../shared/channelmath.js";
import { download } from "../export-csv.js";
import { fmt, pct, labelOf, economicsOf, StatusDot } from "./shared.jsx";

export default function Compare({ data, T, C, api, onChanged, focus }) {
  const channels = data.channels.filter((c) => c.active);
  const others = channels.filter((c) => c.id !== IN_STORE_ID);
  const [mode, setMode] = useState(focus?.itemKey ? "item" : "menu");
  const [channelId, setChannelId] = useState(focus?.channelId || others[0]?.id || "");
  const [itemKey, setItemKey] = useState(focus?.itemKey || data.items[0]?.key || "");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copyFrom, setCopyFrom] = useState("");

  const channel = channels.find((c) => c.id === channelId) || others[0] || null;
  const item = data.items.find((i) => i.key === itemKey) || data.items[0] || null;
  const listed = (cid, key) => data.prices?.[cid]?.[key];
  const draftOf = (cid, key) => draft[cid]?.[key];
  /* The price in effect for a row: what is typed, else what is listed, else
     the counter's — which is what the register charges there. */
  const priceOf = (cid, row) => {
    const d = draftOf(cid, row.key);
    if (d !== undefined) return d === "" ? row.price : Number(d) || 0;
    return listed(cid, row.key) ?? row.price;
  };
  const setDraftPrice = (cid, key, value) => setDraft((d) => ({ ...d, [cid]: { ...(d[cid] || {}), [key]: value } }));
  const drafts = Object.values(draft).reduce((n, m) => n + Object.keys(m).length, 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.items.filter((i) => !q || labelOf(i).toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q));
  }, [data.items, query]);

  const suggest = () => {
    if (!channel) return;
    const next = { ...(draft[channel.id] || {}) };
    for (const row of shown) {
      const e = economicsOf(data, row, channel, priceOf(channel.id, row));
      if (e.recommended && Math.abs(e.recommended - priceOf(channel.id, row)) > 0.005) next[row.key] = String(e.recommended);
    }
    setDraft((d) => ({ ...d, [channel.id]: next }));
  };

  const apply = async () => {
    setBusy(true);
    setNote("");
    try {
      let saved = 0;
      for (const [cid, map] of Object.entries(draft)) {
        const ch = channels.find((c) => c.id === cid);
        const prices = Object.entries(map).map(([key, value]) => {
          const row = data.items.find((i) => i.key === key);
          const price = value === "" ? null : Number(value);
          const rec = row && ch ? economicsOf(data, row, ch, price || row.price).recommended : null;
          return { itemKey: key, price, recommended: price !== null && rec !== null && Math.abs(rec - price) < 0.005 };
        });
        if (!prices.length) continue;
        const out = await api("PUT", "prices", { channelId: cid, prices });
        saved += out.changed || 0;
      }
      setDraft({});
      setNote(fill(T.compare.applied, { n: saved }));
      await onChanged();
    } catch (err) {
      setNote(T.list.errors[err.code] || T.list.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!copyFrom || !channel) return;
    setBusy(true);
    setNote("");
    try {
      const out = await api("POST", "copy", { from: copyFrom, to: channel.id });
      setNote(fill(T.compare.copied, { n: out.changed || 0 }));
      setCopyFrom("");
      await onChanged();
    } catch (err) {
      setNote(T.list.errors[err.code] || T.list.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const exportList = () => {
    if (!channel) return;
    const rows = [[T.cols.item, T.cols.inStore, `${T.cols.price} (${channel.name})`, T.cols.channelCost, T.cols.recipeCost, T.cols.profit, T.cols.margin]];
    for (const row of data.items) {
      const price = priceOf(channel.id, row);
      const e = economicsOf(data, row, channel, price);
      rows.push([labelOf(row), fmt(row.price), fmt(price), fmt(e.channelCost), row.cost === null ? "" : fmt(row.cost), row.cost === null ? "" : fmt(e.contribution), row.cost === null ? "" : pct(e.marginPct)]);
    }
    download(`prices-${channel.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, rows);
  };

  if (!data.items.length) return <p className="panel p-5 text-sm" style={{ color: C.slate }}>{T.compare.noItems}</p>;
  if (!others.length) return <p className="panel p-5 text-sm" style={{ color: C.slate }}>{T.compare.noChannels}</p>;

  const input = (cid, row, editable) => {
    const d = draftOf(cid, row.key);
    const value = d !== undefined ? d : listed(cid, row.key) !== undefined ? String(listed(cid, row.key)) : "";
    if (!editable || cid === IN_STORE_ID) return <span className="data text-sm font-semibold" dir="ltr">{fmt(priceOf(cid, row))}</span>;
    return (
      <input value={value} onChange={(e) => setDraftPrice(cid, row.key, e.target.value.replace(/[^\d.]/g, ""))}
        inputMode="decimal" dir="ltr" placeholder={fmt(row.price)} aria-label={T.cols.price}
        className="w-[5.25rem] px-2 py-1.5 rounded-lg text-sm data text-end outline-none"
        style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${d !== undefined ? C.iris : C.hairline}` }} />
    );
  };

  /* One row of figures: used for an item on the chosen channel, and for a
     channel under the chosen item. */
  const line = (key, title, sub, cid, row, ch) => {
    const e = economicsOf(data, row, ch, priceOf(cid, row));
    const hasCost = row.cost !== null;
    return (
      <div key={key} className="py-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{title}</div>
            {sub && <div className="text-[11px] truncate" style={{ color: C.slate }}>{sub}</div>}
          </div>
          {input(cid, row, data.can.manage)}
        </div>
        {hasCost ? (
          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px]" style={{ color: C.slate }}>
              <span>{T.cols.channelCost} <b className="data" dir="ltr" style={{ color: C.ink }}>{fmt(e.channelCost)}</b></span>
              <span>{T.cols.recipeCost} <b className="data" dir="ltr" style={{ color: C.ink }}>{fmt(row.cost)}</b></span>
              <span>{T.cols.profit} <b className="data" dir="ltr" style={{ color: e.contribution > 0 ? C.ink : C.rose }}>{fmt(e.contribution)}</b> · <span dir="ltr">{pct(e.marginPct)}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status={e.status} C={C} label={T.status[e.status]} />
              {cid !== IN_STORE_ID && data.can.manage && e.recommended && Math.abs(e.recommended - priceOf(cid, row)) > 0.005 && (
                <button onClick={() => setDraftPrice(cid, row.key, String(e.recommended))}
                  className="px-2 py-1 rounded-full text-[11px] font-bold data" dir="ltr" style={{ background: C.irisWash, color: C.iris }}>
                  → {fmt(e.recommended)}
                </button>
              )}
            </div>
          </div>
        ) : <p className="mt-1.5 text-[11px]" style={{ color: C.slate }}>{T.compare.noCost}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="panel p-3 md:p-4 space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          {["menu", "item"].map((m) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              className="px-3.5 py-2 rounded-full text-xs font-semibold"
              style={{ background: mode === m ? C.ink : "var(--chip-bg)", color: mode === m ? C.surface : C.ink }}>
              {m === "menu" ? T.compare.fullMenu : T.compare.oneItem}
            </button>
          ))}
        </div>
        {mode === "menu" ? (
          <>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {others.map((c) => (
                <button key={c.id} onClick={() => setChannelId(c.id)} aria-pressed={channel?.id === c.id}
                  className="shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold"
                  style={{ background: channel?.id === c.id ? C.iris : "var(--chip-bg)", color: channel?.id === c.id ? "#fff" : C.ink }}>{c.name}</button>
              ))}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={T.compare.search}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none" style={{ background: "var(--chip-bg)", color: C.ink }} />
          </>
        ) : (
          <select value={item?.key || ""} onChange={(e) => setItemKey(e.target.value)} aria-label={T.compare.pickItem}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none" style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` }}>
            {data.items.map((i) => <option key={i.key} value={i.key}>{labelOf(i)}</option>)}
          </select>
        )}

        {data.can.manage && mode === "menu" && channel && (
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={suggest} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: C.irisWash, color: C.iris }}>
              <Wand2 size={14} />{T.compare.suggest}
            </button>
            <button onClick={exportList} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: "var(--chip-bg)", color: C.ink }}>
              <Download size={14} />{T.compare.export}
            </button>
            <span className="inline-flex items-center gap-1.5">
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label={T.compare.copy}
                className="px-2.5 py-2 rounded-xl text-xs font-semibold outline-none" style={{ background: "var(--chip-bg)", color: C.ink }}>
                <option value="">{T.compare.copy}…</option>
                {others.filter((c) => c.id !== channel.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {copyFrom && <button onClick={copy} disabled={busy} className="p-2 rounded-xl" style={{ background: C.iris, color: "#fff" }} aria-label={T.compare.copy}><Copy size={14} /></button>}
            </span>
          </div>
        )}
        {!data.can.manage && mode === "menu" && channel && (
          <button onClick={exportList} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: "var(--chip-bg)", color: C.ink }}>
            <Download size={14} />{T.compare.export}
          </button>
        )}
      </div>

      {(drafts > 0 || note) && (
        <div className="panel p-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: drafts ? C.iris : undefined }}>
          <span className="text-xs font-semibold" style={{ color: drafts ? C.ink : C.mint }}>{drafts ? fill(T.compare.draftNote, { n: drafts }) : note}</span>
          {drafts > 0 && (
            <span className="flex gap-2">
              <button onClick={() => setDraft({})} disabled={busy} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: "var(--chip-bg)", color: C.slate }}>
                <X size={13} />{T.compare.discard}
              </button>
              <button onClick={apply} disabled={busy} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold" style={{ background: C.iris, color: "#fff" }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{busy ? T.compare.applying : T.compare.apply}
              </button>
            </span>
          )}
        </div>
      )}

      <div className="panel px-4 pb-2">
        {mode === "menu" && channel
          ? shown.map((row) => line(row.key, labelOf(row), `${T.cols.inStore} ${fmt(row.price)}${row.category ? ` · ${row.category}` : ""}`, channel.id, row, channel))
          : item && channels.map((c) => line(c.id, c.name, c.id === IN_STORE_ID ? "" : listed(c.id, item.key) === undefined && draftOf(c.id, item.key) === undefined ? T.compare.atCounter : "", c.id, item, c))}
      </div>
    </div>
  );
}
