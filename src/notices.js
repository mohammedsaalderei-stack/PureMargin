/* What the app has to tell you.

   Settings has had a "What we'll tell you about" panel since the beginning:
   nine switches, a daily target and an end-of-day time. Everything it saved
   went to localStorage and nothing ever read it, so a person turned on "tell
   me when margin slips", waited, and was told nothing. A preference nobody
   consults is worse than an absent one — it is a promise the product makes and
   then quietly breaks.

   This reads them. Each notice is derived from figures already on screen, so
   nothing new is fetched and nothing is stored: the notice exists because the
   number does. Turning a switch off does not suppress a notice that was
   already made; it means the notice is never made at all.

   Deliberately no persistence beyond "what have I seen". A notification centre
   that accumulates history becomes an inbox somebody has to clear, and this is
   meant to be glanced at and forgotten. */

/* What a notice is about, and therefore who it is for.

   Not everybody wants telling. A cashier does not need to hear that the margin
   slipped — it is not their number, they cannot act on it, and a bell that
   only ever carries somebody else's business becomes a bell they stop reading.
   The same goes for a chef and the day's takings.

   Gated by what each notice contains rather than by a list of roles, so the
   rule survives a new role being added and matches what the rest of the app
   already enforces: if a person cannot open the screen a notice is about, they
   do not get the notice. Somebody with none of these capabilities has no bell
   at all, rather than a bell that is permanently empty. */
export const NOTICE_NEEDS = {
  alertMargin: "view:profitability",
  alertWeekly: "view:profitability",
  alertGoal: "view:profitability",
  alertTarget: "view:profitability",
  /* Sales figures for the day, which a branch manager and above act on. */
  alertEod: "view:reports",
  alertSwing: "view:reports",
  alertPeak: "view:reports",
  /* These two are about the shift rather than the business, and they were the
     tempting exception — a cashier can see the day's takings, so why not tell
     them the first order landed?

     Because it is not their job to be told. They are at the till when it
     happens. The notice adds nothing they do not already know, and one
     pointless notice is enough to teach somebody that the bell is not worth
     opening — which costs them the one that matters later. Held at
     view:reports with the rest, so a cashier and a chef have no bell at all
     rather than a bell that cries wolf. */
  alertFirst: "view:reports",
  alertOrder: "view:reports",
};

/* Whether this person can receive anything at all. Used to decide if the bell
   exists, which is different from whether it is empty today. */
export function noticesApply(capabilities = []) {
  return Object.values(NOTICE_NEEDS).some((need) => capabilities.includes(need));
}

export const ALERT_KEYS = [
  "alertEod", "alertSwing", "alertMargin", "alertOrder",
  "alertTarget", "alertFirst", "alertPeak", "alertWeekly", "alertGoal",
];

/* A move worth mentioning. Below this, day-to-day noise in a restaurant
   produces a notice every single day and the bell stops meaning anything. */
const SWING_PCT = 15;
const MARGIN_FLOOR = 55;

function pref(prefs, key) {
  /* Absent means on. Somebody who has never opened Settings should still be
     told the things worth telling, and defaulting to silence would make the
     feature invisible to everyone who did not go looking for it. */
  return prefs?.[key] !== false;
}

export function buildNotices(data, prefs = {}, opts = {}) {
  if (!data) return [];
  /* Absent means unrestricted, so a caller that does not know about
     capabilities — a test, a preview — still gets everything. */
  const caps = opts.capabilities;
  const t = opts.t;
  const target = Number(opts.dailyTarget) || 0;
  const now = opts.now ?? Date.now();
  const out = [];

  const totals = data.totals || {};
  const today = data.today || {};
  const sales = Number(today.sales ?? totals.sales ?? 0);
  const margin = Number(totals.marginPct ?? 0);
  const swing = Number(totals.salesDelta ?? 0);

  /* `ask` is the question this notice would prompt, phrased as somebody would
     actually type it. A notice that says margin is slipping and offers no way
     to find out why is a nudge to go hunting; carrying the question across
     means the answer is one press away. */
  const add = (id, key, tone, title, body, ask) => {
    const need = NOTICE_NEEDS[key];
    if (caps && need && !caps.includes(need)) return;
    out.push({ id, key, tone, title, body, ask, at: now });
  };

  if (pref(prefs, "alertFirst") && Number(today.receipts) > 0) {
    add("first", "alertFirst", "info", t.notices.firstTitle,
      t.notices.firstBody);
  }

  if (pref(prefs, "alertSwing") && Math.abs(swing) >= SWING_PCT) {
    add("swing", "alertSwing", swing > 0 ? "good" : "warn",
      swing > 0 ? t.notices.swingUpTitle : t.notices.swingDownTitle,
      opts.fill(t.notices.swingBody, { pct: Math.abs(Math.round(swing)) }),
      t.notices.swingAsk);
  }

  if (pref(prefs, "alertMargin") && margin > 0 && margin < MARGIN_FLOOR) {
    add("margin", "alertMargin", "warn", t.notices.marginTitle,
      opts.fill(t.notices.marginBody, { pct: Math.round(margin) }),
      t.notices.marginAsk);
  }

  if (target > 0 && sales > 0) {
    if (pref(prefs, "alertGoal") && sales >= target) {
      add("goal", "alertGoal", "good", t.notices.goalTitle,
        opts.fill(t.notices.goalBody, { pct: Math.round((sales / target) * 100) }),
        t.notices.goalAsk);
    } else if (pref(prefs, "alertTarget") && sales >= target * 0.8) {
      /* Only one of the two fires. Being told you are four fifths of the way
         there and then that you arrived, within the same glance, is two
         notices for one fact. */
      add("target", "alertTarget", "info", t.notices.targetTitle,
        opts.fill(t.notices.targetBody, { pct: Math.round((sales / target) * 100) }),
        t.notices.targetAsk);
    }
  }

  if (pref(prefs, "alertPeak") && totals.peakHour) {
    add("peak", "alertPeak", "info", t.notices.peakTitle,
      opts.fill(t.notices.peakBody, { hour: totals.peakHour }),
      t.notices.peakAsk);
  }

  if (pref(prefs, "alertEod") && opts.pastEod) {
    add("eod", "alertEod", "info", t.notices.eodTitle,
      opts.fill(t.notices.eodBody, { orders: Number(today.receipts || 0) }),
      t.notices.eodAsk);
  }

  if (pref(prefs, "alertWeekly") && opts.isWeekEnd) {
    add("weekly", "alertWeekly", "info", t.notices.weeklyTitle, t.notices.weeklyBody,
      t.notices.weeklyAsk);
  }

  /* "Every single order" is off unless somebody deliberately asked for it, and
     even then it is one notice with a count rather than one per receipt. A
     bell that rings on every sale is a bell that gets silenced. */
  if (prefs?.alertOrder === true && Number(today.receipts) > 0) {
    add("orders", "alertOrder", "info", t.notices.ordersTitle,
      opts.fill(t.notices.ordersBody, { n: Number(today.receipts) }));
  }

  return out;
}

export function pastEod(eodTime, now = new Date()) {
  if (!eodTime || !/^\d{2}:\d{2}$/.test(eodTime)) return false;
  const [h, m] = eodTime.split(":").map(Number);
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

export function isWeekEnd(now = new Date()) {
  /* The working week here ends on a Saturday, which is when "how the week
     went" is a question somebody is actually asking. */
  return now.getDay() === 6;
}
