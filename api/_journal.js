/* A capped, append-only list on top of the key-value store.

   Both the sync log and the audit log are the same shape: newest first, bounded
   so a busy account can't grow one key without limit, and never rewritten in
   place. Keeping that in one place means the two logs can't drift apart in how
   they trim or order themselves.

   The store has no list primitives (it must work on plain KV as well as Redis),
   so an entry is a read-modify-write of one array. That races under concurrent
   writes and can lose an entry; for a log that exists to be read by a human
   that's an acceptable trade for working on all three backends. It is NOT
   acceptable for anything the app's behaviour depends on, so nothing reads
   these logs to make a decision. */

import { getJSON, setJSON } from "./_store.js";

const CAP = 50;

export async function append(key, entry, cap = CAP) {
  const list = (await getJSON(key)) || [];
  const next = [{ at: Date.now(), ...entry }, ...list].slice(0, cap);
  await setJSON(key, next);
  return next[0];
}

export async function recent(key, limit = CAP) {
  const list = (await getJSON(key)) || [];
  return list.slice(0, limit);
}
