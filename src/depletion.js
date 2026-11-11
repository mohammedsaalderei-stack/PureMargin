/* Keeping the ledger level with the till.

   Called after a metrics refresh, from the client, because that is when
   somebody is actually looking. A cron would run against every account
   whether or not anyone was there, and a background worker is a whole piece
   of infrastructure to solve a problem this does not have.

   Everything about it is deliberately quiet. It is not awaited, so the
   dashboard never waits on the ledger. It reports nothing on success, because
   somebody watching their sales does not need to be told that stock was
   deducted — that is the point of it being automatic. And it swallows its own
   failures: the endpoint refuses with 409 when the setting is off, which is
   the normal case for anybody who has turned it off, and treating the normal
   case as an error would put a red message on a screen for no reason. */

export async function depleteFromSales(token, branches) {
  /* The scope's branches are store records; the endpoint takes an id. Sent
     whole, each one arrived as "[object Object]" and was refused as a
     branch nobody may use, so this never caught anything up. */
  /* And with no store to name there is nothing to ask. This used to send one
     request for "no store in particular", which the endpoint can only
     refuse — and the first refresh of every visit did exactly that, because
     the sales arrive before the list of stores does. */
  const list = (branches || []).map((b) => (b && typeof b === "object" ? b.id : b)).filter(Boolean);
  let asked = 0;
  for (const branchId of list) {
    asked += 1;
    try {
      await fetch("/api/stock?what=deplete-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branchId }),
      });
    } catch {
      /* Offline, or the till is unreachable. The next refresh will catch up,
         and nothing was half-written: the endpoint posts a receipt or does
         not. */
    }
  }
  return asked;
}
