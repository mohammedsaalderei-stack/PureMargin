import { MoreHorizontal, MessageSquare } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";
import NeonMark from "./NeonMark.jsx";

/* The mobile shell.

   Not a shrunk desktop. The side rail cost 60px of a 360px screen — a sixth
   of the width, permanently, on the axis phones have least of. Navigation
   moves to the bottom, where it costs height instead (phones are tall) and
   sits under the thumb rather than at the far corner.

   Same screens, same data, same components — only the chrome differs. A
   separate mobile app would mean two codebases drifting apart and every fix
   landing twice. */

/* Five is what fits a thumb-sized target across the narrowest common phone;
   the rest live behind "more". */
const PRIMARY = ["overview", "ask", "watch", "menu", "advice"];
const SECONDARY = ["forecast", "billing", "settings"];

export default function MobileShell({
  tab, go, tabIcons, labelFor, children,
  liveDot, onOpenChats, onOpenMenu, menuOpen, sheet,
}) {
  const C = useC();
  const { t } = useLang();

  const inMore = SECONDARY.includes(tab);

  return (
    <div className="h-screen flex flex-col substrate relative overflow-hidden">
      {/* Top bar: identity and freshness only. Everything actionable is
          within thumb reach at the bottom instead. */}
      <header
        className="h-14 shrink-0 flex items-center justify-between px-3 gap-2 z-20"
        style={{
          background: "rgba(8,8,15,.92)",
          backdropFilter: "blur(20px)",
          borderBottom: `1px solid ${C.edge}`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <NeonMark size={30} glow={0.85} />
          <span className="display font-bold text-base truncate-safe">{t.name}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {liveDot}
          {tab === "ask" && (
            <button
              onClick={onOpenChats}
              className="p-2 rounded-lg"
              style={{ color: C.slate }}
              aria-label={t.chats.title}
            >
              <MessageSquare size={19} />
            </button>
          )}
        </div>
      </header>

      {sheet}

      {/* Full width. Nothing takes a column from the content. */}
      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>

      <nav
        className="shrink-0 z-20"
        style={{
          background: "rgba(8,8,15,.95)",
          backdropFilter: "blur(20px)",
          borderTop: `1px solid ${C.edge}`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label={t.nav.menu}
      >
        <div className="flex items-stretch">
          {PRIMARY.map((id) => {
            const Icon = tabIcons[id];
            const on = tab === id;
            return (
              <button
                key={id}
                onClick={() => go(id)}
                className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 relative"
                style={{ height: 58, color: on ? C.neon : C.slate }}
                aria-current={on ? "page" : undefined}
              >
                {/* The active marker sits on the top edge, so it reads as a
                    tab rather than a floating pill. */}
                <span
                  className="absolute top-0 rounded-full transition-all duration-300"
                  style={{
                    height: 2,
                    width: on ? 26 : 0,
                    background: C.neon,
                    boxShadow: on ? `0 0 8px ${C.neon}` : "none",
                  }}
                />
                <Icon size={19} strokeWidth={on ? 2.3 : 1.8} />
                <span
                  className="text-[10px] font-medium leading-none truncate-safe max-w-full px-1"
                  style={{ opacity: on ? 1 : 0.75 }}
                >
                  {labelFor(id)}
                </span>
              </button>
            );
          })}

          <button
            onClick={onOpenMenu}
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 relative"
            style={{ height: 58, color: menuOpen || inMore ? C.neon : C.slate }}
            aria-label={t.nav.menu}
            aria-expanded={menuOpen}
          >
            <span
              className="absolute top-0 rounded-full transition-all duration-300"
              style={{
                height: 2,
                width: inMore ? 26 : 0,
                background: C.neon,
                boxShadow: inMore ? `0 0 8px ${C.neon}` : "none",
              }}
            />
            <MoreHorizontal size={19} strokeWidth={menuOpen || inMore ? 2.3 : 1.8} />
            <span className="text-[10px] font-medium leading-none" style={{ opacity: 0.85 }}>
              {t.nav.more}
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}

export { PRIMARY, SECONDARY };
