import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/db.js";
import { seed } from "../seed/seed.js";
import { createSecurity } from "../src/security.js";
import { listen } from "../src/web/server.js";

let server;
let base;

async function session() {
  const res = await fetch(`${base}/api/session`);
  const { csrf } = await res.json();
  const cookie = res.headers.getSetCookie?.()[0] || res.headers.get("set-cookie");
  return { csrf, cookie };
}

function post(path, body, extra = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "X-CSRF-Token": extra.csrf,
      cookie: extra.cookie,
    },
    body: JSON.stringify({ agree: true, ...body }),
  });
}

before(async () => {
  const db = openDb(":memory:");
  seed(db, { force: true });
  server = await listen(0, db, createSecurity({ rateMax: 50 }));
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
    assert.ok(stats.rooms >= 1);
  });

  it("hides phone and email on listing cards", async () => {
    const rows = await (await fetch(`${base}/api/listings`)).json();
    assert.ok(rows.length);
    assert.equal(rows[0].email, undefined);
    assert.equal(rows[0].phone, undefined);
  });

  it("adds a company with contact information", async () => {
    const auth = await session();
    const res = await post(
      "/api/businesses",
      {
        name: "710 Tire Shop",
        category: "auto",
        description: "New and used tires, patches, and balancing. Open Tuesday through Saturday.",
        owner_name: "Chris Molina",
        phone: "(772) 555-0444",
        email: "chris@710tires.example",
        website: "",
        address: "SW Warfield Blvd, Indiantown, FL 34956",
      },
      auth,
    );
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.name, "710 Tire Shop");
    assert.equal(row.phone, undefined);
  });

  it("posts a marketplace listing", async () => {
    const auth = await session();
    const res = await post(
      "/api/listings",
      {
        title: "Two goats, bottle trained",
        category: "for-sale",
        description: "Friendly pair. You pick up near the canal. Hay included for the first week.",
        price: "120",
        contact_name: "Riley",
        phone: "7725550455",
        email: "riley@example.com",
        neighborhood: "Canal side",
      },
      auth,
    );
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.price_cents, 12000);
  });

  it("does not accept a listing outside the town board categories", async () => {
    const auth = await session();
    const res = await post(
      "/api/listings",
      {
        title: "Something else entirely",
        category: "invoices",
        description: "This should not be a valid Indiantown board category.",
        contact_name: "Pat",
        phone: "7725550466",
        email: "pat@example.com",
        neighborhood: "Downtown",
      },
      auth,
    );
    assert.equal(res.status, 400);
  });

  it("finds a listing through search", async () => {
    const data = await (await fetch(`${base}/api/search?q=goats`)).json();
    assert.ok(data.listings.some((row) => /goats/i.test(row.title)));
  });

  it("finds an approved chat room through search", async () => {
    const data = await (await fetch(`${base}/api/search?q=Booker`)).json();
    assert.ok(data.rooms.some((row) => /Booker Park/i.test(row.title)));
    assert.ok(data.rooms.every((row) => row.status === "approved"));
  });

  it("serves the Indiantown Board page and not another product name", async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Indiantown Board/);
    assert.match(html, /village-seal\.png/);
    assert.match(html, /data-search-form/);
    assert.doesNotMatch(html, /Chrono/i);
    assert.doesNotMatch(html, /legal billing/i);
  });

  it("serves the Village seal", async () => {
    const res = await fetch(`${base}/village-seal.png`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /image\/png/);
  });
});
