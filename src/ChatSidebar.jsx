import { useMemo, useState } from "react";
import { MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";
import { groupByDate, searchConversations } from "./conversations.js";

export default function ChatSidebar({ conversations, activeId, onSelect, onNew, onDelete, online = true }) {
  const C = useC();
  const { t } = useLang();
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => groupByDate(searchConversations(conversations, query), t),
    [conversations, query, t]
  );

  const empty = conversations.length === 0;
  const noMatch = !empty && groups.length === 0;

  return (
    <div className="h-full flex flex-col" style={{ background: C.surface }}>
      <div className="p-3 space-y-2.5" style={{ borderBottom: `1px solid ${C.hairline}` }}>
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          <Plus size={15} /> {t.chats.newChat}
        </button>

        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
        >
          <Search size={14} style={{ color: C.slate }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.chats.search}
            className="flex-1 bg-transparent outline-none text-xs min-w-0"
          />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] px-1" style={{ color: C.slate }}>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: online ? "#3FBF7F" : C.slate }}
          />
          {online ? t.chats.online : t.chats.offline}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {empty && (
          <p className="text-xs text-center px-3 py-6" style={{ color: C.slate }}>{t.chats.empty}</p>
        )}
        {noMatch && (
          <p className="text-xs text-center px-3 py-6" style={{ color: C.slate }}>{t.chats.noMatch}</p>
        )}

        {groups.map((g) => (
          <div key={g.key} className="mb-4">
            <div className="text-[11px] font-semibold px-2 mb-1.5" style={{ color: C.slate }}>
              {g.label}
            </div>
            {g.items.map((c) => {
              const on = c.id === activeId;
              return (
                <div
                  key={c.id}
                  className="group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer"
                  style={{ background: on ? C.irisWash : "transparent" }}
                  onClick={() => onSelect(c.id)}
                >
                  <MessageSquare size={13} className="shrink-0" style={{ color: on ? C.iris : C.slate }} />
                  <span
                    className="flex-1 text-xs truncate"
                    style={{ color: on ? C.irisDeep : C.ink }}
                  >
                    {c.title || t.chats.untitled}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0 transition-opacity"
                    aria-label={t.chats.delete}
                    style={{ color: C.rose }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
