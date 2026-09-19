import { useState } from "react";
import { Home, Truck, Coffee, UtensilsCrossed, Check, ChevronRight, Loader2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

/* What kind of business this is.

   ── What choosing actually does, and what it must not seem to do ─────────

   It reorders the nav. That is all, and the wording has to carry that or the
   screen becomes a trap: four cards with distinct feature lists read as four
   editions of the product, and somebody picking "home business" will believe
   they have just given up inventory. They have not — `_types.js` cannot remove
   a tab, only promote one — and the lead line says so in as many words.

   The tags are what each type is like to run rather than what it unlocks, for
   the same reason. "Simple and quick" describes a home kitchen; "professional
   tools" would be a lie about a paywall.

   ── Why this is a screen and not a dropdown in settings ──────────────────

   It is both. A new business is asked once, on a screen with room to explain
   the four; everybody else finds it in settings, where the same component
   renders `compact` without the heading or the button. One set of cards, one
   set of descriptions — a second copy is how the two drift into disagreeing
   about what a cafe is. */

const ICONS = {
  home_business: Home,
  food_truck: Truck,
  cafe: Coffee,
  restaurant: UtensilsCrossed,
};

/* The accent each type carries on its card. Not semantic — nothing here is a
   warning or a success — so they are drawn straight from the palette rather
   than from the tone tokens, which mean something. */
const TINT = {
  home_business: "iris",
  food_truck: "mint",
  cafe: "amber",
  restaurant: "cyan",
};

const ORDER = ["home_business", "food_truck", "cafe", "restaurant"];

export default function BusinessTypePicker({
  value = null,
  types = ORDER,
  busy = false,
  error = "",
  compact = false,
  onChoose,
  onContinue,
}) {
  const C = useC();
  const { t } = useLang();
  const s = t.businessType;

  /* Held here so a tap lights up immediately, rather than waiting for a round
     trip to tell somebody that the thing they just pressed is selected. */
  const [picked, setPicked] = useState(value);
  const chosen = picked ?? value;

  const list = ORDER.filter((id) => types.includes(id));

  const choose = (id) => {
    setPicked(id);
    onChoose?.(id);
  };

  return (
    <div className={compact ? "" : "min-h-full flex flex-col"}
      style={compact ? undefined : { background: C.bone, color: C.ink }}>
      <div className={compact ? "" : "flex-1 w-full max-w-lg mx-auto px-4 py-8"}>
        {!compact && (
          <>
            <h1 className="display font-bold text-2xl text-center mb-2">{s.title}</h1>
            <p className="text-sm text-center mb-6" style={{ color: C.slate }}>{s.lead}</p>
          </>
        )}

        <div className="space-y-3">
          {list.map((id) => {
            const Icon = ICONS[id];
            const on = chosen === id;
            const tint = C[TINT[id]];
            return (
              <button
                key={id}
                type="button"
                onClick={() => choose(id)}
                disabled={busy}
                aria-pressed={on}
                className="w-full text-start rounded-2xl p-4 flex items-start gap-3 disabled:opacity-60"
                style={{
                  background: on ? `color-mix(in srgb, ${tint} 10%, var(--panel-solid, transparent))` : C.surface,
                  border: `1.5px solid ${on ? tint : C.hairline}`,
                }}
              >
                <span className="shrink-0 rounded-xl flex items-center justify-center"
                  style={{
                    width: 46, height: 46,
                    background: `color-mix(in srgb, ${tint} 12%, transparent)`,
                    color: tint,
                  }}>
                  <Icon size={22} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-base">{s[id].name}</span>
                  {/* The English name beneath the translated one, in every
                      language. A kitchen in Dubai is staffed by people reading
                      four different scripts, and "Food Truck" is the label they
                      will all have heard. */}
                  <span className="block text-xs mb-1.5" style={{ color: C.slate }} dir="ltr">
                    {s[id].en}
                  </span>
                  <span className="block text-xs" style={{ color: C.slate }}>{s[id].blurb}</span>
                  <span className="inline-block mt-2 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}>
                    {s[id].tag}
                  </span>
                </span>

                {/* The tick, in a slot that is always there. Without a reserved
                    slot every card shifts sideways when one is selected. */}
                <span className="shrink-0 rounded-full flex items-center justify-center mt-0.5"
                  style={{
                    width: 24, height: 24,
                    background: on ? tint : "transparent",
                    border: on ? "none" : `1.5px solid ${C.hairline}`,
                    color: "#fff",
                  }}>
                  {on && <Check size={14} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="text-xs mt-3 text-center" style={{ color: C.rose }}>{error}</p>}

        {!compact && (
          <>
            <button
              type="button"
              onClick={() => onContinue?.(chosen)}
              disabled={busy || !chosen}
              className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-4 rounded-2xl text-base font-bold disabled:opacity-40"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} className="flip-rtl" />}
              {s.continue}
            </button>

            {/* The reassurance, last and quiet. It is the sentence that stops
                somebody agonising over a choice that costs them nothing. */}
            <p className="text-[11px] text-center mt-3 px-4" style={{ color: C.slate }}>
              {s.reassure}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
