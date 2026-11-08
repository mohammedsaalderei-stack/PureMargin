/* A test business on the local test server, ready to sell.

   node scripts/local-test-seed.mjs

   Talks to the server started by scripts/local-test-server.sh over HTTP, the
   way the app does — nothing here touches storage directly, and nothing can
   reach the production database. Creates one owner account with every
   package, the five sample dishes, two barcoded products, delivery-app
   payment types, two preset discounts, tax-invoice receipt details, staff and
   customers, and receives the sample delivery so there is stock to draw down.

   The login is written to .local-test/login.txt (ignored by git) rather than
   printed. Run it again and it signs in to the existing account. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const API = process.env.TEST_API || "http://127.0.0.1:3001/api";
const LOGIN = new URL("../.local-test/login.txt", import.meta.url);
mkdirSync(new URL("../.local-test/", import.meta.url), { recursive: true });

const call = async (path, { method = "GET", body, token } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
};

const username = "owner";
const email = "owner@test.local";
let password;
if (existsSync(LOGIN)) password = readFileSync(LOGIN, "utf8").split("\n")[1];
else {
  password = `Test-${randomBytes(4).toString("hex")}`;
  writeFileSync(LOGIN, `${username}\n${password}\n`);
}

let token;
try {
  token = (await call("/register", { method: "POST", body: { username, password, email } })).token;
  console.log("created the account");
} catch {
  token = (await call("/login", { method: "POST", body: { identifier: username, username, password } })).token;
  console.log("signed in to the existing account");
}

/* Every package, through the admin panel's own grant. */
const admin = await call("/admin", { method: "POST", body: { action: "login", identifier: email, password } });
await call("/admin", { method: "POST", token: admin.adminToken, body: { action: "grant", username, items: ["assistant", "operations", "costs"], months: 12 } })
  .catch(() => call("/admin", { method: "POST", body: { action: "grant", username, items: ["assistant", "operations", "costs"], months: 12 }, token: admin.adminToken }));
console.log("granted every package");

const dishes = [
  ["Chicken shawarma wrap", "Wraps", 18, [["Chicken thigh", 150, "g"], ["Tortilla wrap", 1, "ea"], ["Garlic", 5, "g"], ["Pickled cucumber", 20, "g"], ["Tomato", 30, "g"], ["Potato", 40, "g"], ["Sumac", 1, "g"]]],
  ["Falafel plate", "Plates", 24, [["Chickpeas", 120, "g"], ["Parsley", 20, "g"], ["Garlic", 5, "g"], ["Cumin", 2, "g"], ["Sunflower oil", 25, "ml"], ["Tahini", 30, "g"], ["Tomato", 40, "g"]]],
  ["Hummus", "Sides", 15, [["Chickpeas", 80, "g"], ["Tahini", 30, "g"], ["Lemon", 20, "g"], ["Garlic", 3, "g"], ["Olive oil", 10, "ml"], ["Salt", 2, "g"], ["Cumin", 1, "g"]]],
  ["Fries", "Sides", 9, [["Potato", 200, "g"], ["Sunflower oil", 30, "ml"], ["Salt", 2, "g"]]],
  ["Mint lemonade", "Drinks", 12, [["Lemon", 120, "g"], ["Fresh mint", 10, "g"], ["Sugar", 25, "g"]]],
];
for (const [menuItem, category, sellPrice, lines] of dishes) {
  await call("/recipes?what=save", { method: "POST", token, body: {
    menuItem, category, sellPrice, portions: 1, effectiveFrom: "2026-10-01",
    lines: lines.map(([name, qty, unit]) => ({ name, qty, unit })),
  } }).catch((e) => console.log("  dish:", e.message.slice(0, 80)));
}
console.log("five dishes on the menu");

/* Register settings. */
const put = (what, body) => call(`/till?what=${what}`, { method: "PUT", token, body });
await put("product", { name: "Water", price: 2, category: "Drinks", barcode: "6291003000017", cost: 0.6, color: "#0891B2" });
await put("product", { name: "Soda can", price: 3.5, category: "Drinks", barcode: "5449000000996", cost: 1.4, color: "#E11D48" });
await put("settings", { section: "paymentTypes", value: [
  { id: "cash", name: "Cash", kind: "cash" }, { id: "card", name: "Card", kind: "card" },
  { name: "Talabat", kind: "other" }, { name: "Deliveroo", kind: "other" },
] });
await put("settings", { section: "discounts", value: [
  { name: "Staff meal", type: "pct", value: 50, restricted: true },
  { name: "Happy hour", type: "pct", value: 10 },
  { name: "AED 5 off", type: "amount", value: 5 },
] });
await put("settings", { section: "receipt", value: {
  business: "Sample Grill", address: "Al Barsha 1, Dubai", phone: "+971 4 000 0000",
  trn: "100000000000003", footer: "Thank you — see you soon",
} });
await put("settings", { section: "options", value: { vatMode: "inclusive", loyaltyPct: 5, useShifts: true } });
console.log("register settings saved");

/* Staff and customers. */
for (const [name, title] of [["Sara", "Cashier"], ["Omar", "Manager"]]) {
  await call("/employees?what=add", { method: "POST", token, body: { name, title, branchId: "register" } }).catch(() => {});
}
for (const c of [{ name: "Mariam Al Hashimi", phone: "+971501112222" }, { name: "Khalid", phone: "+971559998888" }]) {
  await put("customer", c).catch(() => {});
}
console.log("staff and customers added");

/* Stock: the sample delivery, and sales drawing it down. */
await call("/inventory?what=meta", { method: "POST", token, body: { autoDepleteFromSales: true } }).catch(() => {});
const lines = [
  ["Chicken thigh", 10, "kg", 228], ["Chickpeas", 5, "kg", 37.5], ["Tahini", 4, "kg", 56], ["Tortilla wrap", 60, "ea", 45],
  ["Parsley", 2, "kg", 24], ["Garlic", 1, "kg", 14], ["Lemon", 3, "kg", 19.5], ["Olive oil", 4, "l", 62],
  ["Sunflower oil", 18, "l", 95], ["Potato", 20, "kg", 45], ["Tomato", 5, "kg", 24], ["Pickled cucumber", 2, "kg", 18],
  ["Fresh mint", 1, "kg", 10], ["Sumac", 0.5, "kg", 15], ["Cumin", 0.5, "kg", 13], ["Salt", 1, "kg", 2], ["Sugar", 2, "kg", 9],
];
const inventory = (await call("/inventory", { token })).ingredients || [];
const byName = new Map(inventory.map((i) => [i.name.toLowerCase(), i]));
await call("/stock?what=invoice", { method: "POST", token, body: {
  branchId: "register", supplier: "Sample Foodstuff Trading LLC", invoiceNo: "INV-TEST-0412", confirm: true,
  lines: lines.map(([name, qty, unit, amount]) => {
    const hit = byName.get(name.toLowerCase());
    return hit
      ? { text: name, ingredientId: hit.id, qty, unit, unitCost: amount / qty }
      : { text: name, qty, unit, unitCost: amount / qty, newItem: { name, stockUnit: unit, category: "dry" } };
  }),
} }).catch((e) => console.log("  stock:", e.message.slice(0, 120)));
console.log("sample delivery received");

console.log("\nReady. Sign in on the phone with the login in .local-test/login.txt");
