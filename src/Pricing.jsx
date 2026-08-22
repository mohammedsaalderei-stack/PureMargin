import { ArrowLeft, Check } from "lucide-react";
import { useC } from "./theme.jsx";
import NeonMark from "./NeonMark.jsx";
import { CONTACT, emailHref } from "./contact.js";
import { useLang } from "./i18n.jsx";
import { useReveal } from "./hooks.js";
import { DirhamMark } from "./Dirham.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

/* Four modules, priced separately. The third carries a launch discount, so
   it's the only one that shows a struck-through price — a badge on every
   card would make the discount meaningless. */
const PRICES = [null, 200, 200, 100];
const WAS = [null, null, 400, null];

function Plan({ index, plan, price, was }) {
  const C = useC();
  const { t } = useLang();
  const [ref, shown] = useReveal(0.1);
  const discounted = was != null;

  return (
    <div
      ref={ref}
      className="panel p-6 md:p-7 flex flex-col"
      style={{
        background: C.surface,
        border: `1px solid ${discounted ? C.iris : C.hairline}`,
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(14px)",
        transition: `opacity .5s ease ${index * 80}ms, transform .5s ease ${index * 80}ms`,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="data text-xs" style={{ color: C.slate }} dir="ltr">
          {String(index + 1).padStart(2, "0")}
        </span>
        {discounted && (
          <span
            className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {t.pricing.offer}
          </span>
        )}
      </div>

      <h3 className="display font-extrabold text-xl mb-2">{plan.name}</h3>
      <p className="text-sm leading-relaxed mb-5" style={{ color: C.slate }}>{plan.body}</p>

      <div className="mb-5 pb-5" style={{ borderBottom: `1px solid ${C.hairline}` }}>
        {price == null ? (
          <>
            <div className="display font-extrabold text-2xl">{t.pricing.onRequest}</div>
            <div className="text-xs mt-1" style={{ color: C.slate }}>{t.pricing.onRequestNote}</div>
          </>
        ) : (
          <>
            {discounted && (
              <div className="text-xs mb-1" style={{ color: C.slate }}>
                {t.pricing.wasPrice}{" "}
                <span className="line-through inline-flex items-baseline gap-1" dir="ltr">
                  <DirhamMark size="0.85em" /> {was}
                </span>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <span className="display font-extrabold text-3xl inline-flex items-baseline gap-1.5" dir="ltr">
                <DirhamMark size="0.8em" /> {price}
              </span>
              <span className="text-xs" style={{ color: C.slate }}>{t.pricing.perMonth}</span>
            </div>
          </>
        )}
      </div>

      <ul className="space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check size={15} className="mt-0.5 shrink-0" style={{ color: C.iris }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Pricing({ onBack, onSignIn }) {
  const C = useC();
  const { t } = useLang();

  return (
    <div className="min-h-full" style={{ background: C.bone }}>
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{ background: `${C.bone}dd`, borderBottom: `1px solid ${C.hairline}` }}
      >
        <div className="max-w-6xl mx-auto px-6 md:px-10 lg:px-16 h-16 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 hover:opacity-70">
            <ArrowLeft size={16} className="flip-rtl" style={{ color: C.slate }} />
            <NeonMark size={34} glow={0.9} />
            <span className="display font-extrabold text-lg">{t.name}</span>
          </button>

          <div className="flex items-center gap-2 md:gap-4">
            <ThemeToggle compact />
            <LanguagePicker compact />
            <button
              onClick={onSignIn}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {t.common.signIn}
            </button>
          </div>
        </div>
      </header>

      <section className="px-6 md:px-10 lg:px-16 pt-14 pb-10 md:pt-20">
        <div className="max-w-6xl mx-auto rise">
          <div className="data text-xs uppercase tracking-[0.18em] mb-4" style={{ color: C.iris }}>
            {t.pricing.eyebrow}
          </div>
          <h1 className="display text-4xl md:text-5xl font-extrabold max-w-3xl leading-[1.1]">
            {t.pricing.title}
          </h1>
          <p className="mt-4 text-base md:text-lg max-w-2xl" style={{ color: C.slate }}>
            {t.pricing.lead}
          </p>
        </div>
      </section>

      <section className="px-6 md:px-10 lg:px-16 pb-8">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-5">
          {t.pricing.plans.map((plan, i) => (
            <Plan key={plan.name} index={i} plan={plan} price={PRICES[i]} was={WAS[i]} />
          ))}
        </div>

        <p className="max-w-6xl mx-auto text-xs leading-relaxed mt-6" style={{ color: C.slate }}>
          {t.pricing.note}
        </p>
      </section>

      <section className="px-6 md:px-10 lg:px-16 py-16 md:py-24">
        <div className="max-w-6xl mx-auto rounded-2xl p-8 md:p-12 text-center" style={{ background: C.panel }}>
          <div className="data text-xs uppercase tracking-[0.18em] mb-4" style={{ color: C.lilac }}>
            {t.pricing.helpTitle}
          </div>
          <h2
            className="display text-2xl md:text-3xl font-extrabold max-w-xl mx-auto leading-[1.2]"
            style={{ color: C.panelText }}
          >
            {t.pricing.helpLead}
          </h2>
          {CONTACT.email && (
            <a
              href={emailHref(CONTACT.email)}
              className="mt-7 inline-block px-6 py-3 rounded-lg font-semibold"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {t.pricing.contact}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
