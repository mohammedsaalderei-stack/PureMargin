import { BarChart3, Camera, Check, LineChart, Lock, MessageSquare, Package, UtensilsCrossed } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";

/* What the account has — read-only.

   Packages are activated by the PureMargin team, not bought in-app: the
   admin panel is the only place entitlements are granted. This screen just
   states what's live, until when, and how to get more. A member of a team
   sees the owner's packages here, because they apply to the whole team. */

const CATALOGUE = [
  { id: "assistant", icon: MessageSquare },
  { id: "menu", icon: UtensilsCrossed },
  { id: "forecast", icon: LineChart },
  { id: "operations", icon: Package },
  { id: "billscan", icon: Camera },
];

export default function Plans({ account }) {
  const C = useC();
  const { t, lang } = useLang();
  const plan = account?.account?.plan || {};
  const owned = (plan.items || []).filter((i) => i !== "table");
  const expired = plan.expired;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10">
        <div className="mb-8">
          <h2 className="display text-2xl md:text-3xl font-extrabold mb-2">{t.billing.title}</h2>
          <p className="text-sm max-w-xl" style={{ color: C.slate }}>{t.billing.viewLead}</p>
          {expired && (
            <p className="text-sm mt-3 font-semibold" style={{ color: C.rose }}>{t.billing.expired}</p>
          )}
        </div>

        {/* The free tier, always on. */}
        <div className="rounded-2xl p-5 mb-5 flex items-start gap-4" style={{ background: C.irisWash }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: C.iris }}>
            <BarChart3 size={18} style={{ color: C.onPrimary }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="display font-extrabold text-lg">{t.billing.freeTitle}</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.surface, color: C.irisDeep }}>
                {t.billing.free}
              </span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: C.slate }}>{t.billing.freeLead}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {CATALOGUE.map(({ id, icon: Icon }) => {
            const isOwned = owned.includes(id) && !expired;
            return (
              <div key={id} className="rounded-2xl p-5"
                style={{
                  background: C.surface,
                  border: `1.5px solid ${isOwned ? C.iris : C.hairline}`,
                  opacity: isOwned ? 1 : 0.65,
                }}>
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: isOwned ? C.iris : C.irisWash }}>
                    <Icon size={17} style={{ color: isOwned ? C.onPrimary : C.iris }} />
                  </div>
                  {isOwned ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
                      style={{ background: C.irisWash, color: C.irisDeep }}>
                      <Check size={11} /> {t.billing.active}
                    </span>
                  ) : (
                    <Lock size={15} style={{ color: C.slate }} />
                  )}
                </div>
                <div className="display font-extrabold text-lg mb-1.5">{t.billing.features[id]}</div>
                <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
                  {t.billing.features[`${id}Body`]}
                </p>
              </div>
            );
          })}
        </div>

        {owned.length > 0 && plan.until && (
          <p className="text-sm mb-6" style={{ color: C.slate }}>
            {t.billing.renews}{" "}
            <span dir="ltr" className="font-semibold" style={{ color: C.ink }}>
              {formatDate(plan.until, lang)}
            </span>
            {plan.inherited && <span className="ms-2 text-xs">({t.billing.inherited})</span>}
          </p>
        )}

        {/* How to get more: through the team, not a checkout. */}
        <div className="rounded-2xl p-5" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
          <div className="display font-bold text-base mb-1">{t.billing.getTitle}</div>
          <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
            {fill(t.billing.getLead, {})}
          </p>
        </div>
      </div>
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
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5" style={{ background: C.irisWash }}>
          <Lock size={22} style={{ color: C.iris }} />
        </div>
        <h3 className="display font-extrabold text-xl mb-2">
          {fill(t.billing.lockedTitle, { name: t.billing.features[feature] || feature })}
        </h3>
        <p className="text-sm leading-relaxed mb-6" style={{ color: C.slate }}>
          {t.billing.lockedLeadAdmin}
        </p>
        <button onClick={onSeePlans} className="px-5 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background: C.iris, color: C.onPrimary }}>
          {t.billing.lockedAction}
        </button>
      </div>
    </div>
  );
}
