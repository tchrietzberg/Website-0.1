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
    body: JSON.stringify(body),
  });
}

before(async () => {
  const db = openDb(":memory:");
  seed(db, { force: true });
  server = await listen(0, db, createSecurity({ rateMax: 80 }));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("moderated chat rooms", () => {
  it("lists only approved rooms to the public", async () => {
    const rows = await (await fetch(`${base}/api/rooms`)).json();
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((row) => row.status === "approved"));
    assert.equal(rows[0].host_email, undefined);
  });

  it("keeps a new room pending until an admin approves it", async () => {
    const auth = await session();
    const created = await post(
      "/api/rooms",
      {
        title: "Canal fishing tips",
        topic: "community",
        description: "Share safe spots and what is biting this week.",
        host_name: "Tomás",
        host_email: "tomas@example.com",
        agree: true,
      },
      auth,
    );
    assert.equal(created.status, 201);
    const room = await created.json();
    assert.equal(room.status, "pending");
    assert.equal((await fetch(`${base}/api/rooms/${room.id}`)).status, 404);

    const login = await post(
      "/api/admin/login",
      { email: "admin@indiantown.example", password: "indiantown-admin" },
      auth,
    );
    assert.equal(login.status, 200);
    const adminCookie = [auth.cookie, login.headers.getSetCookie?.()[0] || login.headers.get("set-cookie")]
      .filter(Boolean)
      .join("; ");
    const admin = { csrf: auth.csrf, cookie: adminCookie };

    const approved = await post(`/api/admin/rooms/${room.id}/approve`, {}, admin);
    assert.equal(approved.status, 200);
    const open = await (await fetch(`${base}/api/rooms/${room.id}`)).json();
    assert.equal(open.status, "approved");
    assert.equal(open.title, "Canal fishing tips");
  });

  it("lets people chat in an approved room and lets an admin hide a message", async () => {
    const rooms = await (await fetch(`${base}/api/rooms`)).json();
    const room = rooms.find((row) => row.title === "Saturday at Booker Park");
    const auth = await session();
    const sent = await post(
      `/api/rooms/${room.id}/messages`,
      { author: "Neighbor", body: "I will bring extra trash bags." },
      auth,
    );
    assert.equal(sent.status, 201);
    const message = await sent.json();

    const login = await post(
      "/api/admin/login",
      { email: "admin@indiantown.example", password: "indiantown-admin" },
      auth,
    );
    const adminCookie = [auth.cookie, login.headers.getSetCookie?.()[0] || login.headers.get("set-cookie")]
      .filter(Boolean)
      .join("; ");
    const hidden = await post(`/api/admin/messages/${message.id}/hide`, {}, { csrf: auth.csrf, cookie: adminCookie });
    assert.equal(hidden.status, 200);
    const publicMessages = await (await fetch(`${base}/api/rooms/${room.id}/messages`)).json();
    assert.ok(!publicMessages.some((row) => row.id === message.id && Number(row.hidden) === 0));
  });

  it("rejects admin login with a bad password", async () => {
    const auth = await session();
    const res = await post(
      "/api/admin/login",
      { email: "admin@indiantown.example", password: "wrong-password" },
      auth,
    );
    assert.equal(res.status, 401);
  });

  it("filters approved rooms by topic", async () => {
    const rows = await (await fetch(`${base}/api/rooms?topic=events`)).json();
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((row) => row.topic === "events" && row.status === "approved"));
  });

  it("blocks chat in a room that is still pending", async () => {
    const auth = await session();
    const created = await post(
      "/api/rooms",
      {
        title: "Youth soccer carpool",
        topic: "youth",
        description: "Share rides to practice at Booker Park this season.",
        host_name: "Diane",
        host_email: "diane@example.com",
        agree: true,
      },
      auth,
    );
    const room = await created.json();
    const sent = await post(
      `/api/rooms/${room.id}/messages`,
      { author: "Neighbor", body: "I can drive Thursday." },
      auth,
    );
    assert.equal(sent.status, 404);
  });

  it("refuses room approval without an admin session", async () => {
    const auth = await session();
    const res = await post("/api/admin/rooms/1/approve", {}, auth);
    assert.equal(res.status, 401);
  });
});
