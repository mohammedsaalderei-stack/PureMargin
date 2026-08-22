import { useState } from "react";
import { BarChart3, Check, LineChart, Loader2, Lock, MessageSquare, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { Money, DirhamMark } from "../Dirham.jsx";

/* The dashboard is free and isn't in this list — it's shown above as
   already included, so the paid cards are only the ones you can act on. */
const CATALOGUE = [
  { id: "assistant", price: 200, icon: MessageSquare },
  { id: "menu", price: 150, icon: UtensilsCrossed },
  { id: "forecast", price: 100, icon: LineChart },
];

/* The demo checkout. It is labelled as one on the screen rather than
   dressed up as a real card form — showing someone a fake card field is a
   good way to have them type a real card number into it. */
function Checkout({ open, items, total, onClose, onConfirm, busy }) {
  const C = useC();
  const { t } = useLang();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="palette-in w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-6"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full mb-4"
          style={{ background: C.lilacWash, color: C.iris }}
        >
          <ShieldCheck size={12} /> {t.billing.mockTitle}
        </div>

        <h3 className="display font-extrabold text-lg mb-2">{t.billing.checkout}</h3>
        <p className="text-sm leading-relaxed mb-5" style={{ color: C.slate }}>
          {t.billing.mockLead}
        </p>

        <div className="rounded-xl p-4 mb-5" style={{ background: C.bone }}>
          {items.map((id) => {
            const entry = CATALOGUE.find((c) => c.id === id);
            return (
              <div key={id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{t.billing.features[id]}</span>
                <span className="data"><Money value={entry.price} /></span>
              </div>
            );
          })}
          <div
            className="flex items-center justify-between pt-3 mt-2 font-bold"
            style={{ borderTop: `1px dashed ${C.hairline}` }}
          >
            <span>{t.billing.total}</span>
            <span className="display"><Money value={total} /> <span className="text-xs font-normal" style={{ color: C.slate }}>/ {t.billing.monthly}</span></span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? t.billing.processing : t.billing.confirm}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 rounded-lg text-sm font-semibold"
            style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
          >
            {t.billing.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Plans({ token, account, onChanged }) {
  const C = useC();
  const { t, lang } = useLang();
  const owned = account?.account?.plan?.items || [];
  const expired = account?.account?.plan?.expired;

  const [picked, setPicked] = useState([]);
  const [checkout, setCheckout] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    if (owned.includes(id)) return;
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const total = picked.reduce((s, id) => s + (CATALOGUE.find((c) => c.id === id)?.price || 0), 0);

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: picked }),
      });
      if (!res.ok) throw new Error();
      setPicked([]);
      setCheckout(false);
      onChanged?.();
    } catch {
      /* Surfaced by the unchanged state — the packages simply don't appear. */
    } finally {
      setBusy(false);
    }
  }

  async function cancelAll() {
    setBusy(true);
    try {
      await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cancel: true }),
      });
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10">
        <div className="mb-8">
          <h2 className="display text-2xl md:text-3xl font-extrabold mb-2">{t.billing.title}</h2>
          <p className="text-sm max-w-xl" style={{ color: C.slate }}>{t.billing.lead}</p>
          {expired && (
            <p className="text-sm mt-3 font-semibold" style={{ color: C.rose }}>{t.billing.expired}</p>
          )}
        </div>

        <div
          className="rounded-2xl p-5 mb-5 flex items-start gap-4"
          style={{ background: C.irisWash }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: C.iris }}
          >
            <BarChart3 size={18} style={{ color: C.onPrimary }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="display font-extrabold text-lg">{t.billing.freeTitle}</span>
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: C.surface, color: C.irisDeep }}
              >
                {t.billing.free}
              </span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
              {t.billing.freeLead}
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          {CATALOGUE.map(({ id, price, icon: Icon }) => {
            const isOwned = owned.includes(id);
            const isPicked = picked.includes(id);
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                disabled={isOwned}
                className="text-start rounded-2xl p-5 transition"
                style={{
                  background: C.surface,
                  border: `1.5px solid ${isOwned ? C.iris : isPicked ? C.iris : C.hairline}`,
                  opacity: isOwned ? 0.75 : 1,
                  cursor: isOwned ? "default" : "pointer",
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: isPicked || isOwned ? C.iris : C.irisWash }}
                  >
                    <Icon size={17} style={{ color: isPicked || isOwned ? C.onPrimary : C.iris }} />
                  </div>
                  {isOwned ? (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
                      style={{ background: C.irisWash, color: C.irisDeep }}
                    >
                      <Check size={11} /> {t.common.live}
                    </span>
                  ) : (
                    isPicked && <Check size={18} style={{ color: C.iris }} />
                  )}
                </div>

                <div className="display font-extrabold text-lg mb-1.5">{t.billing.features[id]}</div>
                <p className="text-sm leading-relaxed mb-4" style={{ color: C.slate }}>
                  {t.billing.features[`${id}Body`]}
                </p>
                <div className="display font-extrabold text-xl inline-flex items-baseline gap-1.5" dir="ltr">
                  <DirhamMark size="0.8em" /> {price}
                  <span className="text-xs font-normal" style={{ color: C.slate }}>/ {t.billing.monthly}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div
          className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
          style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        >
          <div className="flex-1">
            <div className="text-xs mb-1" style={{ color: C.slate }}>
              {picked.length ? fill(t.billing.selected, { n: picked.length }) : t.billing.pickOne}
            </div>
            <div className="display font-extrabold text-2xl">
              <Money value={total} />{" "}
              <span className="text-sm font-normal" style={{ color: C.slate }}>/ {t.billing.monthly}</span>
            </div>
          </div>
          <button
            onClick={() => setCheckout(true)}
            disabled={!picked.length}
            className="rounded-lg px-6 py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {t.billing.checkout}
          </button>
        </div>

        {owned.length > 0 && (
          <div className="mt-6 flex items-center justify-between text-sm">
            <span style={{ color: C.slate }}>
              {t.billing.renews}{" "}
              <span dir="ltr">
                {account?.account?.plan?.until
                  ? new Date(account.account.plan.until).toLocaleDateString(localeFor(lang))
                  : "—"}
              </span>
            </span>
            <button onClick={cancelAll} disabled={busy} className="font-semibold" style={{ color: C.rose }}>
              {t.billing.cancelPlan}
            </button>
          </div>
        )}
      </div>

      <Checkout
        open={checkout}
        items={picked}
        total={total}
        busy={busy}
        onClose={() => setCheckout(false)}
        onConfirm={confirm}
      />
    </div>
  );
}

/* Shown in place of a screen the account hasn't bought. */
export function Locked({ feature, onSeePlans }) {
  const C = useC();
  const { t } = useLang();
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5"
          style={{ background: C.irisWash }}
        >
          <Lock size={22} style={{ color: C.iris }} />
        </div>
        <h3 className="display font-extrabold text-xl mb-2">
          {fill(t.billing.lockedTitle, { name: t.billing.features[feature] })}
        </h3>
        <p className="text-sm leading-relaxed mb-6" style={{ color: C.slate }}>
          {t.billing.lockedLead}
        </p>
        <button
          onClick={onSeePlans}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {t.billing.lockedAction}
        </button>
      </div>
    </div>
  );
}
