import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { CONTACT, emailHref } from "./contact.js";
import { useLang } from "./i18n.jsx";
import { useReveal } from "./hooks.js";
import { DirhamMark } from "./Dirham.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

/* Three packages, priced per month per business. Aligned index-for-index with
   `pricing.plans` in the dictionary.

   ── What is not a card ───────────────────────────────────────────────────

   Two of the five cards here were not packages. "An extra branch" had no
   feature id behind it, so it could be chosen and would grant nothing; it is a
   percentage of whatever the monthly total already is, which is a modifier and
   not a thing to buy. "Till hardware" is a physical machine quoted per order —
   the software cannot switch it on, and pricing it beside three subscriptions
   invited somebody to add it to a basket that does not exist.

   Both are still on the page, below the cards, stated as what they are.

   `WAS` carries a struck-through price when a package is discounted. Empty at
   the moment: a badge on every card would make the discount mean nothing. */
const PRICES = [250, 150, 200];
const WAS = [null, null, null];

/* Kept in step with `BRANCH_SURCHARGE_PCT` in `api/billing.js`. Stated in one
   sentence rather than computed, because the page cannot know a total it has
   not been told. */
const BRANCH_SURCHARGE_PCT = 50;

const TERMS = [1, 3, 6, 12];

function Plan({ index, plan, price, was, months }) {
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
            {months > 1 && (
              <div className="text-xs mt-1.5" style={{ color: C.slate }}>
                {t.pricing.billedAs
                  .replace("{total}", String(price * months))
                  .replace("{n}", String(months))}
              </div>
            )}
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
  const [months, setMonths] = useState(1);

  return (
    <div className="min-h-full" style={{ background: C.bone }}>
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{ background: `${C.bone}dd`, borderBottom: `1px solid ${C.hairline}` }}
      >
        <div className="max-w-6xl mx-auto px-6 md:px-10 lg:px-16 h-16 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 hover:opacity-70">
            <ArrowLeft size={16} className="flip-rtl" style={{ color: C.slate }} />
            <BrandMark size={34} />
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
        {/* Term selector: a month, a quarter, half a year, or a year. */}
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2 mb-6">
          <span className="text-sm font-semibold me-1">{t.pricing.termLabel}</span>
          {TERMS.map((m) => (
            <button key={m} onClick={() => setMonths(m)}
              className="px-3.5 py-1.5 rounded-lg text-sm font-semibold"
              style={months === m
                ? { background: C.iris, color: C.onPrimary }
                : { border: `1px solid ${C.hairline}`, color: C.slate }}>
              {t.pricing.terms[String(m)]}
            </button>
          ))}
        </div>

        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {t.pricing.plans.map((plan, i) => (
            <Plan key={plan.name} index={i} plan={plan} price={PRICES[i]} was={WAS[i]} months={months} />
          ))}
        </div>

        {/* The two things that are priced but are not packages. Below the
            cards and visibly different from them, because putting a quote and
            a percentage in the same row as three monthly prices is what made
            people try to buy them. */}
        <div className="max-w-6xl mx-auto mt-8 grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl p-5" style={{ border: `1px solid ${C.hairline}` }}>
            <div className="display font-extrabold text-base mb-1.5">{t.pricing.extras.branches.name}</div>
            <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
              {t.pricing.extras.branches.body.replace("{pct}", String(BRANCH_SURCHARGE_PCT))}
            </p>
          </div>
          <div className="rounded-2xl p-5" style={{ border: `1px solid ${C.hairline}` }}>
            <div className="display font-extrabold text-base mb-1.5">{t.pricing.extras.hardware.name}</div>
            <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
              {t.pricing.extras.hardware.body}
            </p>
          </div>
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
