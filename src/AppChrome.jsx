/* The frame around every back-office screen: portals along the top,
   essentials along the bottom.

   On a phone it reads like the shopping apps people already know: a row of
   portals under the header (Business, Register, Kitchen, Team), and a bar of
   at most five buttons at the bottom — the portal's essentials and More. On
   a computer the same portals sit in the top bar and the portal's screens in
   a row of tabs beneath it, so the whole width is the screen's and nothing
   runs down the side.

   The register is not drawn inside this frame. Choosing it opens the till
   full screen (`register/RegisterApp.jsx`), with its own controls and a way
   back. */

import { useEffect, useRef, useState } from "react";
import { BarChart3, Store, ChefHat, Users, MoreHorizontal, X, LogOut, Lock, ChevronDown, UserCircle2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

export const PORTAL_ICONS = { business: BarChart3, register: Store, kitchen: ChefHat, team: Users };

const tabName = (t, id) => t[id]?.tab || id;
const shortName = (t, id) => { const full = tabName(t, id); return full.length > 11 ? full.split(/\s+/)[0] : full; };

/* The portals, as a row of large pills. */
export function PortalSwitcher({ layout, current, onPick, compact = false }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos.nav;
  return (
    <div className={`flex gap-2 ${compact ? "" : "overflow-x-auto no-scrollbar px-3 py-2"}`} role="tablist" aria-label={P.portals}>
      {layout.map((p) => {
        const Icon = PORTAL_ICONS[p.id];
        const on = p.id === current;
        return (
          <button key={p.id} role="tab" aria-selected={on} onClick={() => onPick(p.id)}
            className={`shrink-0 flex items-center gap-2 rounded-full font-semibold transition-all ${compact ? "px-3.5 py-1.5 text-[13px]" : "px-4 py-2 text-sm"}`}
            style={{
              background: on ? C.iris : "var(--chip-bg)",
              color: on ? "#fff" : C.ink,
              boxShadow: on ? "0 6px 18px -8px rgba(124,58,237,0.7)" : "none",
            }}>
            <Icon size={compact ? 15 : 16} strokeWidth={2.2} />
            {P[p.id]}
          </button>
        );
      })}
    </div>
  );
}

/* A portal's screens, as tabs under the top bar on a computer. */
export function SectionTabs({ portal, tab, onGo, locked }) {
  const C = useC();
  const { t } = useLang();
  if (!portal) return null;
  const ids = [...portal.primary, ...portal.more];
  if (ids.length < 2) return null;
  return (
    <nav className="flex gap-1 px-6 overflow-x-auto no-scrollbar" style={{ borderBottom: `1px solid ${C.hairline}` }}>
      {ids.map((id) => {
        const on = id === tab;
        return (
          <button key={id} onClick={() => onGo(id)}
            className="relative px-3.5 py-3 text-sm font-semibold whitespace-nowrap flex items-center gap-1.5"
            style={{ color: on ? C.ink : C.slate }} aria-current={on ? "page" : undefined}>
            {tabName(t, id)}
            {locked(id) && <Lock size={11} />}
            {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: C.iris }} />}
          </button>
        );
      })}
    </nav>
  );
}

/* The bottom bar on a phone: the essentials, then More. */
export function BottomBar({ portal, tab, onGo, icons, onMore, moreOpen }) {
  const C = useC();
  const { t } = useLang();
  if (!portal) return null;
  const items = portal.primary.slice(0, 4);
  return (
    <nav className="shrink-0 grid z-30"
      style={{
        gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))`,
        background: "var(--panel-solid)",
        backdropFilter: "blur(20px)",
        borderTop: `1px solid ${C.hairline}`,
        paddingBottom: "var(--inset-bottom)",
      }}>
      {items.map((id) => {
        const Icon = icons[id];
        const on = id === tab && !moreOpen;
        return (
          <button key={id} onClick={() => onGo(id)} className="flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]"
            style={{ color: on ? C.iris : C.slate }} aria-current={on ? "page" : undefined}>
            {Icon && <Icon size={21} strokeWidth={on ? 2.4 : 1.9} />}
            {/* A long name ("حساب التكاليف") would be cut off under the icon, so
                the bar uses its first word; the screen's title gives it whole. */}
            <span className="text-[10.5px] font-semibold truncate max-w-full px-1">{shortName(t, id)}</span>
          </button>
        );
      })}
      <button onClick={onMore} className="flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]"
        style={{ color: moreOpen ? C.iris : C.slate }} aria-expanded={moreOpen}>
        <MoreHorizontal size={21} strokeWidth={moreOpen ? 2.4 : 1.9} />
        <span className="text-[10.5px] font-semibold">{t.pos.nav.more}</span>
      </button>
    </nav>
  );
}

/* More: the portal's other screens, your account, and the switches that
   used to fill the bottom of the sidebar. */
export function MoreSheet({ open, onClose, portal, tab, onGo, icons, locked, account, extra, onLogout, user }) {
  const C = useC();
  const { t } = useLang();
  if (!open) return null;
  const rest = portal ? [...portal.primary.slice(4), ...portal.more] : [];
  const row = (id) => {
    const Icon = icons[id];
    return (
      <button key={id} onClick={() => { onGo(id); onClose(); }}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-start"
        style={{ color: id === tab ? C.iris : C.ink, borderBottom: `1px solid ${C.hairline}` }}>
        {Icon && <Icon size={19} />}
        <span className="flex-1 text-sm font-semibold">{tabName(t, id)}</span>
        {locked(id) && <Lock size={12} style={{ color: C.slate }} />}
      </button>
    );
  };
  return (
    <div className="fixed inset-0 z-40 flex items-end own-insets" style={{ background: C.scrim }} onClick={onClose}>
      <div className="w-full rounded-t-3xl max-h-[80vh] overflow-y-auto palette-in"
        style={{ background: C.surface, paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="display font-bold text-base" style={{ color: C.ink }}>{t.pos.nav.more}</span>
          <button onClick={onClose} aria-label={t.pos.common.close} className="p-2 rounded-full" style={{ color: C.slate, background: "var(--chip-bg)" }}><X size={16} /></button>
        </div>
        {rest.length > 0 && <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.hairline}` }}>{rest.map(row)}</div>}
        <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.hairline}` }}>{account.map(row)}</div>
        {extra}
        <div className="mx-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm" style={{ color: C.slate }}>{t.settings.language}</span><LanguagePicker />
          </div>
          <ThemeToggle />
          <button onClick={onLogout} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold"
            style={{ border: `1px solid ${C.hairline}`, color: C.rose }}>
            <LogOut size={15} className="flip-rtl" /> {t.common.signOut}
          </button>
          <p className="text-center text-xs pb-2" style={{ color: C.slate }}>{t.settings.signedInAs} {user}</p>
        </div>
      </div>
    </div>
  );
}

/* Your account on a computer: a menu from the avatar, with what used to sit
   at the foot of the sidebar. */
export function AccountMenu({ user, business, onGo, onLogout, items, locked }) {
  const C = useC();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 ps-1.5 pe-2.5 py-1.5 rounded-full"
        style={{ background: "var(--chip-bg)", color: C.ink }} aria-expanded={open}>
        <UserCircle2 size={22} style={{ color: C.iris }} />
        <span className="text-sm font-semibold max-w-[140px] truncate">{business || user}</span>
        <ChevronDown size={14} style={{ color: C.slate }} />
      </button>
      {open && (
        <div className="absolute end-0 mt-2 w-72 rounded-2xl p-2 z-50 palette-in"
          style={{ background: C.surface, border: `1px solid ${C.hairline}`, boxShadow: "0 24px 48px -16px rgba(0,0,0,0.45)" }}>
          <div className="px-3 py-2 text-xs" style={{ color: C.slate }}>{t.settings.signedInAs} <b style={{ color: C.ink }}>{user}</b></div>
          {items.map((id) => (
            <button key={id} onClick={() => { onGo(id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-start" style={{ color: C.ink }}>
              <span className="flex-1">{t[id]?.tab || id}</span>{locked(id) && <Lock size={12} style={{ color: C.slate }} />}
            </button>
          ))}
          <div className="flex items-center justify-between gap-2 px-3 py-2"><LanguagePicker /><ThemeToggle compact /></div>
          <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold" style={{ color: C.rose }}>
            <LogOut size={15} className="flip-rtl" /> {t.common.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
