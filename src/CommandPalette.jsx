import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, LineChart, MessageSquare, Settings as Cog, UtensilsCrossed, Search, CornerDownLeft } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

const SCREEN_ICONS = {
  ask: MessageSquare,
  watch: BarChart3,
  menu: UtensilsCrossed,
  forecast: LineChart,
  settings: Cog,
};

/* Cmd/Ctrl-K palette. Jumps between screens, or sends a question straight
   to Ask without switching first. */
export default function CommandPalette({ open, onClose, onGo, onAsk }) {
  const C = useC();
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const screens = useMemo(
    () =>
      ["ask", "watch", "menu", "forecast", "settings"]
        .map((id) => ({ id, label: t[id].tab }))
        .filter((s) => !query || s.label.toLowerCase().includes(query.toLowerCase())),
    [query, t]
  );

  const asking = query.trim().length > 2;
  const rows = [
    ...screens.map((s) => ({ kind: "screen", ...s })),
    ...(asking ? [{ kind: "ask", id: "ask-query", label: query.trim() }] : []),
  ];

  useEffect(() => {
    if (index >= rows.length) setIndex(0);
  }, [rows.length, index]);

  if (!open) return null;

  const run = (row) => {
    if (!row) return;
    if (row.kind === "screen") onGo(row.id);
    else onAsk(row.label);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="palette-in w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <Search size={17} style={{ color: C.slate }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, rows.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); run(rows[index]); }
            }}
            placeholder={t.palette.placeholder}
            className="flex-1 bg-transparent outline-none text-sm py-1"
          />
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {rows.length === 0 && (
            <p className="px-4 py-6 text-sm text-center" style={{ color: C.slate }}>{t.palette.none}</p>
          )}

          {screens.length > 0 && (
            <div className="px-4 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.slate }}>
              {t.palette.screens}
            </div>
          )}

          {rows.map((row, i) => {
            const Icon = row.kind === "screen" ? SCREEN_ICONS[row.id] : MessageSquare;
            const active = i === index;
            return (
              <div key={row.id}>
                {row.kind === "ask" && (
                  <div className="px-4 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.slate }}>
                    {t.palette.ask}
                  </div>
                )}
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(row)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-start text-sm"
                  style={{ background: active ? C.irisWash : "transparent" }}
                >
                  <Icon size={16} style={{ color: active ? C.iris : C.slate }} />
                  <span className="flex-1 truncate">
                    {row.kind === "ask" ? `${t.palette.askAbout} "${row.label}"` : row.label}
                  </span>
                  {active && <CornerDownLeft size={13} style={{ color: C.slate }} />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 text-[11px]" style={{ borderTop: `1px solid ${C.hairline}`, color: C.slate }}>
          {t.palette.hint}
        </div>
      </div>
    </div>
  );
}
