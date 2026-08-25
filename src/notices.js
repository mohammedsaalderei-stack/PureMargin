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
  const t = opts.t;
  const target = Number(opts.dailyTarget) || 0;
  const now = opts.now ?? Date.now();
  const out = [];

  const totals = data.totals || {};
  const today = data.today || {};
  const sales = Number(today.sales ?? totals.sales ?? 0);
  const margin = Number(totals.marginPct ?? 0);
  const swing = Number(totals.salesDelta ?? 0);

  const add = (id, key, tone, title, body) =>
    out.push({ id, key, tone, title, body, at: now });

  if (pref(prefs, "alertFirst") && Number(today.receipts) > 0) {
    add("first", "alertFirst", "info", t.notices.firstTitle,
      t.notices.firstBody);
  }

  if (pref(prefs, "alertSwing") && Math.abs(swing) >= SWING_PCT) {
    add("swing", "alertSwing", swing > 0 ? "good" : "warn",
      swing > 0 ? t.notices.swingUpTitle : t.notices.swingDownTitle,
      opts.fill(t.notices.swingBody, { pct: Math.abs(Math.round(swing)) }));
  }

  if (pref(prefs, "alertMargin") && margin > 0 && margin < MARGIN_FLOOR) {
    add("margin", "alertMargin", "warn", t.notices.marginTitle,
      opts.fill(t.notices.marginBody, { pct: Math.round(margin) }));
  }

  if (target > 0 && sales > 0) {
    if (pref(prefs, "alertGoal") && sales >= target) {
      add("goal", "alertGoal", "good", t.notices.goalTitle,
        opts.fill(t.notices.goalBody, { pct: Math.round((sales / target) * 100) }));
    } else if (pref(prefs, "alertTarget") && sales >= target * 0.8) {
      /* Only one of the two fires. Being told you are four fifths of the way
         there and then that you arrived, within the same glance, is two
         notices for one fact. */
      add("target", "alertTarget", "info", t.notices.targetTitle,
        opts.fill(t.notices.targetBody, { pct: Math.round((sales / target) * 100) }));
    }
  }

  if (pref(prefs, "alertPeak") && totals.peakHour) {
    add("peak", "alertPeak", "info", t.notices.peakTitle,
      opts.fill(t.notices.peakBody, { hour: totals.peakHour }));
  }

  if (pref(prefs, "alertEod") && opts.pastEod) {
    add("eod", "alertEod", "info", t.notices.eodTitle,
      opts.fill(t.notices.eodBody, { orders: Number(today.receipts || 0) }));
  }

  if (pref(prefs, "alertWeekly") && opts.isWeekEnd) {
    add("weekly", "alertWeekly", "info", t.notices.weeklyTitle, t.notices.weeklyBody);
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
