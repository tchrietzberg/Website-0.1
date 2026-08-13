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

async function adminAuth(auth) {
  const login = await post(
    "/api/admin/login",
    { email: "admin@indiantown.example", password: "indiantown-admin" },
    auth,
  );
  assert.equal(login.status, 200);
  const adminCookie = [auth.cookie, login.headers.getSetCookie?.()[0] || login.headers.get("set-cookie")]
    .filter(Boolean)
    .join("; ");
  return { csrf: auth.csrf, cookie: adminCookie };
}

async function requestRoom(auth, fields) {
  const created = await post(
    "/api/rooms",
    {
      title: "Canal fishing tips",
      topic: "community",
      description: "Share safe spots and what is biting this week.",
      host_name: "Tomás",
      host_email: "tomas@example.com",
      agree: true,
      ...fields,
    },
    auth,
  );
  assert.equal(created.status, 201);
  return created.json();
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
  it("starts with no public rooms", async () => {
    const rows = await (await fetch(`${base}/api/rooms`)).json();
    assert.deepEqual(rows, []);
  });

  it("keeps a new room pending until an admin approves it", async () => {
    const auth = await session();
    const room = await requestRoom(auth);
    assert.equal(room.status, "pending");
    assert.equal((await fetch(`${base}/api/rooms/${room.id}`)).status, 404);

    const admin = await adminAuth(auth);
    const approved = await post(`/api/admin/rooms/${room.id}/approve`, {}, admin);
    assert.equal(approved.status, 200);
    const open = await (await fetch(`${base}/api/rooms/${room.id}`)).json();
    assert.equal(open.status, "approved");
    assert.equal(open.title, "Canal fishing tips");
    assert.equal(open.host_email, undefined);
  });

  it("lets people chat in an approved room and lets an admin hide a message", async () => {
    const auth = await session();
    const room = await requestRoom(auth, {
      title: "Saturday park cleanup",
      topic: "events",
      description: "Who is bringing water, shade, and extra gloves this week.",
    });
    const admin = await adminAuth(auth);
    assert.equal((await post(`/api/admin/rooms/${room.id}/approve`, {}, admin)).status, 200);

    const sent = await post(
      `/api/rooms/${room.id}/messages`,
      { author: "Neighbor", body: "I will bring extra trash bags." },
      auth,
    );
    assert.equal(sent.status, 201);
    const message = await sent.json();
    const hidden = await post(`/api/admin/messages/${message.id}/hide`, {}, admin);
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
    const room = await requestRoom(auth, {
      title: "Youth soccer carpool",
      topic: "youth",
      description: "Share rides to practice at Booker Park this season.",
      host_name: "Diane",
      host_email: "diane@example.com",
    });
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
