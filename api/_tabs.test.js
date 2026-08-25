/* Tab access, and the exceptions an owner can make.

   What these protect: a role sees only what its capabilities earn; a grant
   opens both the tab and the data behind it; role grants and personal grants
   add rather than replace; Team and Packages can never be handed out; and
   junk in the grant record is discarded rather than trusted. */

import assert from "node:assert/strict";
import {
  TAB_ACCESS, TAB_KEYS, UNGRANTABLE, grantable,
  normaliseGrants, grantedTabs, capabilitiesFor, allowedTabs,
} from "./_tabs.js";
import { ROLES } from "./_org.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const org = (tabGrants = {}) => ({
  id: "org-1",
  ownerUsername: "owner",
  tabGrants,
  members: {
    owner: { role: "owner" },
    chef: { role: "chef" },
    till: { role: "cashier" },
  },
});

const tabsFor = (role, o = org(), who = role) =>
  allowedTabs(capabilitiesFor(o, who, role));

test("every tab is accounted for", () => {
  assert.equal(TAB_KEYS.length, Object.keys(TAB_ACCESS).length);
  assert.ok(TAB_KEYS.includes("costs") && TAB_KEYS.includes("messages"));
});

test("the owner sees everything", () => {
  assert.deepEqual(tabsFor("owner").sort(), [...TAB_KEYS].sort());
});

test("a cashier sees only the till and the open tabs", () => {
  assert.deepEqual(tabsFor("cashier").sort(),
    ["ask", "costs", "messages", "overview", "settings"]);
});

test("a cashier is kept out of margin data and billing", () => {
  const tabs = tabsFor("cashier");
  for (const shut of ["watch", "menu", "advice", "forecast", "variance", "billing", "team"]) {
    assert.ok(!tabs.includes(shut), `${shut} must not be open to a cashier`);
  }
});

test("a chef gets the kitchen, not the money", () => {
  const tabs = tabsFor("chef");
  assert.ok(tabs.includes("recipes") && tabs.includes("inventory"));
  assert.ok(!tabs.includes("watch") && !tabs.includes("variance"));
});

test("only the owner gets Team and Packages", () => {
  for (const role of ["ops", "branch_manager", "chef", "cashier", "accountant"]) {
    const tabs = tabsFor(role);
    assert.ok(!tabs.includes("team"), `${role} must not manage users`);
    assert.ok(!tabs.includes("billing"), `${role} must not see billing`);
  }
});

test("everybody gets the assistant, the board and their own settings", () => {
  for (const role of Object.keys(ROLES)) {
    const tabs = tabsFor(role);
    for (const open of ["ask", "messages", "settings"]) {
      assert.ok(tabs.includes(open), `${role} should have ${open}`);
    }
  }
});

test("a grant to a role opens the tab for that role", () => {
  const o = org({ roles: { chef: ["variance"] } });
  assert.ok(tabsFor("chef", o).includes("variance"));
  assert.ok(!tabsFor("cashier", o).includes("variance"), "and nobody else");
});

test("a grant to a person opens it for that person only", () => {
  const o = org({ users: { chef: ["watch"] } });
  assert.ok(tabsFor("chef", o, "chef").includes("watch"));
  assert.ok(!tabsFor("chef", o, "someone_else").includes("watch"));
});

test("a grant carries the capability behind the screen", () => {
  const o = org({ roles: { cashier: ["watch"] } });
  const caps = capabilitiesFor(o, "till", "cashier");
  assert.ok(caps.includes("view:profitability"),
    "granting the picture without the data is the empty screen this prevents");
});

test("role and personal grants add rather than replace", () => {
  const o = org({ roles: { chef: ["variance"] }, users: { chef: ["watch"] } });
  const tabs = tabsFor("chef", o, "chef");
  assert.ok(tabs.includes("variance") && tabs.includes("watch"));
});

test("Team and Packages can never be granted", () => {
  const o = org({ roles: { cashier: ["team", "billing"] }, users: { till: ["team"] } });
  assert.deepEqual(grantedTabs(o, "till", "cashier"), []);
  assert.ok(!tabsFor("cashier", o, "till").includes("team"));
  for (const id of UNGRANTABLE) assert.ok(!grantable().includes(id));
});

test("an always-open tab is not offered as a grant", () => {
  for (const id of ["ask", "messages", "settings"]) {
    assert.ok(!grantable().includes(id), `${id} is already open to everyone`);
  }
});

test("an unknown tab or role in the record is discarded", () => {
  const clean = normaliseGrants({
    roles: { chef: ["watch", "nonsense"], wizard: ["watch"] },
    users: { chef: ["notatab"] },
  });
  assert.deepEqual(clean.roles.chef, ["watch"]);
  assert.equal(clean.roles.wizard, undefined);
  assert.equal(clean.users.chef, undefined, "an entry with nothing valid is dropped");
});

test("a granted name is matched however it was capitalised", () => {
  const clean = normaliseGrants({ users: { "  CHEF  ": ["watch"] } });
  assert.deepEqual(clean.users.chef, ["watch"]);
});

test("duplicates in a grant collapse", () => {
  const clean = normaliseGrants({ roles: { chef: ["watch", "watch"] } });
  assert.deepEqual(clean.roles.chef, ["watch"]);
});

test("no grants means base capabilities, unchanged", () => {
  const o = org();
  assert.deepEqual(capabilitiesFor(o, "chef", "chef").sort(), [...ROLES.chef.can].sort());
});

test("someone with no capabilities still gets the open tabs", () => {
  assert.deepEqual(allowedTabs([]).sort(), ["ask", "messages", "settings"]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
