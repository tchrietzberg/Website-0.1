import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/db.js";
import { seed } from "../seed/seed.js";
import { createSecurity } from "../src/security.js";
import { listen } from "../src/web/server.js";

let server;
let base;

const listing = {
  title: "Spare folding chairs",
  category: "for-sale",
  description: "Four metal chairs. Pick up near Booker Park this weekend.",
  contact_name: "Lee",
  phone: "7725550477",
  email: "lee@example.com",
  neighborhood: "Booker Park",
  agree: true,
};

before(async () => {
  const db = openDb(":memory:");
  seed(db, { force: true });
  server = await listen(0, db, createSecurity({ rateMax: 8, rateWindowMs: 60_000 }));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function auth() {
  const res = await fetch(`${base}/api/session`);
  const { csrf } = await res.json();
  const cookie = res.headers.getSetCookie?.()[0] || res.headers.get("set-cookie");
  return { csrf, cookie };
}

describe("board security", () => {
  it("sends security headers on every page", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(res.headers.get("content-security-policy"), /frame-src https:\/\/www\.facebook\.com/);
  });

  it("rejects a post without a CSRF token", async () => {
    const res = await fetch(`${base}/api/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(listing),
    });
    assert.equal(res.status, 403);
  });

  it("rejects a honeypot spam post", async () => {
    const { csrf, cookie } = await auth();
    const res = await fetch(`${base}/api/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        "X-CSRF-Token": csrf,
        cookie,
      },
      body: JSON.stringify({ ...listing, fax: "http://spam.example" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects a cross-origin post", async () => {
    const { csrf, cookie } = await auth();
    const res = await fetch(`${base}/api/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "X-CSRF-Token": csrf,
        cookie,
      },
      body: JSON.stringify(listing),
    });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /Bad origin/);
  });

  it("accepts a first-party post from localhost or a preview host", async () => {
    const { csrf, cookie } = await auth();
    const port = new URL(base).port;
    const send = (headers) =>
      fetch(`${base}/api/news`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          cookie,
          ...headers,
        },
        body: JSON.stringify({
          title: "Chat join from the local board",
          body: "Neighbors should be able to send a note from localhost or 127.0.0.1.",
          author: "Neighbor",
          agree: true,
        }),
      });

    const loopback = await send({ Origin: `http://localhost:${port}` });
    assert.equal(loopback.status, 201);

    const preview = await send({
      Origin: "https://preview.example",
      "X-Forwarded-Host": "preview.example",
    });
    assert.equal(preview.status, 201);

    const browser = await send({
      Origin: "https://preview.example",
      "Sec-Fetch-Site": "same-origin",
    });
    assert.equal(browser.status, 201);
  });

  it("rate-limits repeated posts from one client", async () => {
    const { csrf, cookie } = await auth();
    const send = () =>
      fetch(`${base}/api/news`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          "X-CSRF-Token": csrf,
          cookie,
        },
        body: JSON.stringify({
          title: "Park notice for neighbors",
          body: "Bring water and gloves if you can help this Saturday morning.",
          author: "Neighbors",
          agree: true,
        }),
      });
    assert.equal((await send()).status, 201);
    assert.equal((await send()).status, 201);
    assert.equal((await send()).status, 201);
    let status = 201;
    for (let i = 0; i < 20 && status === 201; i += 1) status = (await send()).status;
    assert.equal(status, 429);
  });
});
