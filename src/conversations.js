/* Chat memory.
   Conversations persist in localStorage, scoped per signed-in user so two
   people on one device don't see each other's threads. There's no server
   store yet — that needs a database — so this survives reloads and browser
   restarts, but not a change of device. The shape below is deliberately
   close to what a real table would hold, so moving it server-side later
   is a swap of these four functions and nothing else. */

const KEY = (user) => `sufra_chats_${user || "anon"}`;
const LIMIT = 60;

function read(user) {
  try {
    const raw = localStorage.getItem(KEY(user));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(user, list) {
  try {
    localStorage.setItem(KEY(user), JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    /* Quota or private mode — the session still works, it just won't persist. */
  }
}

export function listConversations(user) {
  return read(user).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(user, id) {
  return read(user).find((c) => c.id === id) || null;
}

/* The title is the first question, trimmed — the same convention every chat
   product uses, because it's what people actually scan for. */
function titleFrom(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "";
  const text = String(first.content).replace(/\s+/g, " ").trim();
  return text.length > 42 ? text.slice(0, 42) + "…" : text;
}

export function saveConversation(user, { id, messages }) {
  if (!messages?.length) return id;
  const list = read(user);
  const now = Date.now();
  const existing = list.find((c) => c.id === id);

  if (existing) {
    existing.messages = messages;
    existing.title = existing.title || titleFrom(messages);
    existing.updatedAt = now;
  } else {
    list.unshift({
      id,
      title: titleFrom(messages),
      messages,
      createdAt: now,
      updatedAt: now,
    });
  }
  write(user, list);
  return id;
}

export function deleteConversation(user, id) {
  write(user, read(user).filter((c) => c.id !== id));
}

export function clearAll(user) {
  write(user, []);
}

export const newId = () =>
  `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/* Buckets match how people remember conversations — "yesterday", "last week" —
   rather than exact dates, which nobody recalls. */
export function groupByDate(list, t) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 864e5;

  const buckets = [
    { key: "today", label: t.chats.today, items: [] },
    { key: "yesterday", label: t.chats.yesterday, items: [] },
    { key: "week", label: t.chats.last7, items: [] },
    { key: "older", label: t.chats.older, items: [] },
  ];

  for (const c of list) {
    const at = c.updatedAt;
    if (at >= startOfToday) buckets[0].items.push(c);
    else if (at >= startOfToday - DAY) buckets[1].items.push(c);
    else if (at >= startOfToday - 7 * DAY) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  }

  return buckets.filter((b) => b.items.length);
}

export function searchConversations(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (c) =>
      c.title?.toLowerCase().includes(q) ||
      c.messages?.some((m) => String(m.content).toLowerCase().includes(q))
  );
}

/* ------------------------------------------------------------------ */
/*  Server sync                                                         */
/*  With a database attached, threads live against the account and      */
/*  follow the person between devices. Without one, everything below    */
/*  fails quietly and the local copy above carries on — the chat must   */
/*  never break because storage isn't configured yet.                   */
/* ------------------------------------------------------------------ */

export async function fetchRemote(token) {
  try {
    const res = await fetch("/api/conversations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    // An unconfigured deployment answers, but nothing it stores survives,
    // so treat that as "no remote" and stay on the local copy.
    if (!json.persistent) return null;
    return Array.isArray(json.conversations) ? json.conversations : [];
  } catch {
    return null;
  }
}

export async function pushRemote(token, { id, title, messages }) {
  try {
    await fetch("/api/conversations", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, title, messages }),
    });
  } catch {
    /* Local copy already holds it. */
  }
}

export async function deleteRemote(token, id) {
  try {
    await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
  } catch {
    /* Local copy already removed it. */
  }
}

/* Merge on sign-in: anything written offline is kept, and the newer copy
   of a thread present in both places wins. */
export function merge(local, remote) {
  const byId = new Map();
  for (const c of [...remote, ...local]) {
    const seen = byId.get(c.id);
    if (!seen || (c.updatedAt || 0) > (seen.updatedAt || 0)) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
