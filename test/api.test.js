import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/db.js";
import { seed } from "../seed/seed.js";
import { listen } from "../src/web/server.js";

let server;
let base;

before(async () => {
  const db = openDb(":memory:");
  seed(db, { force: true });
  server = await listen(0, db);
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("Indiantown Board API", () => {
  it("seeds civic resources and local listings", async () => {
    const stats = await (await fetch(`${base}/api/stats`)).json();
    assert.ok(stats.listings >= 1);
    assert.ok(stats.businesses >= 1);
    assert.ok(stats.resources >= 1);
    const resources = await (await fetch(`${base}/api/resources`)).json();
    assert.ok(resources.some((row) => /indiantownfl\.gov/i.test(row.url || "")));
  });

  it("adds a company with contact information", async () => {
    const res = await fetch(`${base}/api/businesses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "710 Tire Shop",
        category: "auto",
        description: "New and used tires, patches, and balancing. Open Tuesday through Saturday.",
        owner_name: "Chris Molina",
        phone: "(772) 555-0444",
        email: "chris@710tires.example",
        website: "",
        address: "SW Warfield Blvd, Indiantown, FL 34956",
      }),
    });
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.name, "710 Tire Shop");
    assert.equal(row.phone, "(772) 555-0444");
  });

  it("posts a marketplace listing", async () => {
    const res = await fetch(`${base}/api/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Two goats, bottle trained",
        category: "for-sale",
        description: "Friendly pair. You pick up near the canal. Hay included for the first week.",
        price: "120",
        contact_name: "Riley",
        phone: "7725550455",
        email: "riley@example.com",
        neighborhood: "Canal side",
      }),
    });
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.price_cents, 12000);
  });

  it("does not accept a listing outside the town board categories", async () => {
    const res = await fetch(`${base}/api/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Something else entirely",
        category: "invoices",
        description: "This should not be a valid Indiantown board category.",
        contact_name: "Pat",
        phone: "7725550466",
        email: "pat@example.com",
        neighborhood: "Downtown",
      }),
    });
    assert.equal(res.status, 400);
  });

  it("serves the Indiantown Board page and not another product name", async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Indiantown Board/);
    assert.doesNotMatch(html, /Chrono/i);
    assert.doesNotMatch(html, /legal billing/i);
  });
});
