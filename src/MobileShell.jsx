import { Menu as MenuIcon, MessageSquare } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";
import BrandMark from "./BrandMark.jsx";

/* The bottom bar is gone.

   It held five tabs and a "more" button, which meant the app had two classes
   of screen — the five that were reachable and the rest, behind a lid. Which
   five was a hand-written list, and it had already gone stale once: Bill scan,
   the screen a cashier uses all shift, was in neither list and could not be
   opened on a phone at all.

   A single drawer holds everything, so there is no list to drift and no tier.
   It opens from the trailing edge — the right in English, the left in Arabic —
   because that is the side the thumb of the hand holding the phone reaches,
   and because `inset-inline-end` follows the writing direction without a
   second layout for RTL.

   PRIMARY is kept and exported: Shell reads it to decide which tabs are worth
   surfacing first inside the drawer. It no longer decides what is reachable. */
const PRIMARY = ["overview", "costs", "ask", "watch", "advice"];

export default function MobileShell({ tab, go, tabIcons, labelFor, children, liveDot, onOpenChats, onOpenMenu, menuOpen, sheet, bell }) {
  const C = useC();
  const { t } = useLang();

  return (
    <div className="h-screen flex flex-col relative overflow-hidden" style={{ background: C.bone }}>
      <header className="h-14 shrink-0 flex items-center justify-between px-3 gap-2 z-20"
        style={{ background: "var(--panel-glass)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${C.hairline}` }}>
        <div className="flex items-center gap-2 min-w-0">
          <BrandMark size={30} />
          <span className="display font-bold text-base truncate-safe grad-text">{t.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {liveDot}
          {bell}
          {tab === "ask" && (
            <button onClick={onOpenChats} className="p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center" style={{ color: C.slate }} aria-label={t.chats.title}>
              <MessageSquare size={19} />
            </button>
          )}
          <button onClick={onOpenMenu}
            className="p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
            style={{ color: menuOpen ? C.iris : C.ink }}
            aria-label={t.nav.menu} aria-expanded={menuOpen} aria-haspopup="menu">
            <MenuIcon size={21} strokeWidth={menuOpen ? 2.4 : 2} />
          </button>
        </div>
      </header>

      {sheet}
      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>

    </div>
  );
}

export { PRIMARY };
