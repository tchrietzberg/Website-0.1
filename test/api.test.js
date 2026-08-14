import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/db.js";
import { seed } from "../seed/seed.js";
import { createSecurity } from "../src/security.js";
import { listen } from "../src/web/server.js";
import { solidPng } from "../src/png.js";

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
    assert.ok(stats.resources >= 20);
    assert.equal(stats.rooms, 0);
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
    assert.equal(row.status, "pending");
    const publicRows = await (await fetch(`${base}/api/listings`)).json();
    assert.ok(!publicRows.some((item) => item.id === row.id));
    assert.equal((await fetch(`${base}/api/listings/${row.id}`)).status, 404);

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
    const approved = await post(`/api/admin/listings/${row.id}/approve`, {}, admin);
    assert.equal(approved.status, 200);
    const live = await (await fetch(`${base}/api/listings/${row.id}`)).json();
    assert.equal(live.title, "Two goats, bottle trained");
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

  it("opens a news story with the full body", async () => {
    const rows = await (await fetch(`${base}/api/news`)).json();
    assert.ok(rows.length);
    const res = await fetch(`${base}/api/news/${rows[0].id}`);
    assert.equal(res.status, 200);
    const story = await res.json();
    assert.equal(story.title, rows[0].title);
    assert.ok(story.body.length > 40);
    assert.equal((await fetch(`${base}/api/news/99999`)).status, 404);
  });

  it("finds a listing through search", async () => {
    const data = await (await fetch(`${base}/api/search?q=mower`)).json();
    assert.ok(data.listings.some((row) => /mower/i.test(row.title)));
  });

  it("lists police, fire, library, and council contacts", async () => {
    const rows = await (await fetch(`${base}/api/resources`)).json();
    const byTitle = (re) => rows.find((row) => re.test(row.title));
    const police = byTitle(/police/i);
    const fire = byTitle(/fire/i);
    const library = byTitle(/library/i);
    const council = byTitle(/council/i);
    assert.ok(police?.phone);
    assert.ok(fire?.phone);
    assert.ok(library?.phone);
    assert.ok(council?.phone);
    assert.match(library.phone, /597-4200/);
    assert.equal(police.category, "safety");
    assert.equal(fire.category, "safety");
  });

  it("filters help resources by category", async () => {
    const rows = await (await fetch(`${base}/api/resources?category=safety`)).json();
    assert.ok(rows.length >= 3);
    assert.ok(rows.every((row) => row.category === "safety"));
  });

  it("finds the library through search", async () => {
    const data = await (await fetch(`${base}/api/search?q=Lahti`)).json();
    assert.ok(data.resources.some((row) => /Lahti/i.test(row.title)));
  });

  it("lists official Indiantown Facebook pages", async () => {
    const data = await (await fetch(`${base}/api/facebook`)).json();
    assert.ok(data.pages.length >= 4);
    assert.ok(data.pages.every((row) => /facebook\.com/i.test(row.href)));
    assert.ok(data.pages.every((row) => /facebook\.com\/plugins\/page\.php/.test(row.embed)));
    assert.ok(data.pages.every((row) => /tabs=timeline/.test(row.embed)));
    assert.ok(data.pages.every((row) => /height=600/.test(row.embed)));
    assert.ok(data.pages.every((row) => /^https:\/\//.test(row.site) && !/facebook\.com/i.test(row.site)));
    assert.ok(data.pages.some((row) => /villageofindiantown/i.test(row.href)));
    assert.ok(data.pages.some((row) => /itownchamber/i.test(row.href)));
    assert.ok(data.pages.some((row) => /indiantownfl\.gov/i.test(row.site)));
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /fb-post-grid/);
    assert.match(js, /pages\.map\(facebookPostCard\)/);
  });

  it("lists recent Indiantown homes that open on Zillow", async () => {
    const data = await (await fetch(`${base}/api/homes`)).json();
    assert.ok(data.recent.length >= 4);
    assert.ok(data.recent.every((row) => /zillow\.com/i.test(row.url)));
    assert.ok(data.recent.every((row) => !row.photo));
    assert.match(data.links.sale, /zillow\.com\/indiantown-fl/);
    assert.match(data.links.newest, /zillow\.com/);
  });

  it("does not list chat rooms until one is approved", async () => {
    const rooms = await (await fetch(`${base}/api/rooms`)).json();
    assert.deepEqual(rooms, []);
    const data = await (await fetch(`${base}/api/search?q=chat`)).json();
    assert.deepEqual(data.rooms, []);
  });

  it("serves the Indiantown Board page and not another product name", async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Indiantown Board/);
    assert.match(html, /village-seal\.png/);
    assert.match(html, /data-search-form/);
    assert.match(html, /#\/homes/);
    assert.match(html, /#\/facebook/);
    assert.match(html, /#\/events/);
    const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
    const links = [...nav.matchAll(/href="([^"]+)"/g)].map((row) => row[1]);
    assert.deepEqual(links.slice(0, 3), ["#/", "#/board", "#/directory"]);
    assert.notEqual(links[1], "#/homes");
    assert.ok(links.indexOf("#/homes") > links.indexOf("#/board"));
    assert.match(html, /English/);
    assert.match(html, /Español/);
    assert.match(html, /data-lang-set="en"/);
    assert.match(html, /data-lang-set="es"/);
    assert.doesNotMatch(html, /Chrono/i);
    assert.doesNotMatch(html, /legal billing/i);
  });

  it("serves the Village seal", async () => {
    const res = await fetch(`${base}/village-seal.png`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /image\/png/);
  });

  it("ships About copy from the Indiantown Wikipedia page", async () => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /Where Great Things Grow/);
    assert.match(js, /Seminole Inn/);
    assert.match(js, /Circle T/);
    assert.match(js, /Payson Park/);
    assert.match(js, /6,560/);
    assert.match(js, /en\.wikipedia\.org\/wiki\/Indiantown,_Florida/);
    assert.match(js, /Davy Jones/);
    assert.match(js, /Cómo se gobierna/);
    assert.match(js, /\/about\/seminole-inn\.jpg/);
    assert.match(js, /#\/about\/\$\{encodeURIComponent/);
    assert.match(js, /about-section-card/);
    assert.match(js, /id: "history"/);
    assert.match(js, /id: "seminole-inn"/);
    assert.match(js, /function renderAboutTopic/);
    const photo = await fetch(`${base}/about/seminole-inn.jpg`);
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get("content-type"), /image\/jpeg/);
    assert.match(js, /about-map-frame/);
    assert.match(js, /openstreetmap\.org\/export\/embed/);
    assert.match(js, /latestJobs/);
    assert.match(js, /storm-strip/);
  });

  it("lists official storm links and dated events", async () => {
    const storm = await (await fetch(`${base}/api/storm`)).json();
    assert.ok(storm.links.some((row) => /weather\.gov\/mlb/i.test(row.href)));
    assert.ok(storm.links.some((row) => /sfwmd\.gov/i.test(row.href)));
    assert.ok(storm.links.some((row) => row.phone === "911"));
    const events = await (await fetch(`${base}/api/events`)).json();
    assert.ok(events.official.some((row) => /indiantownfl\.gov/i.test(row.href)));
    assert.ok(events.official.some((row) => /indiantownchamber\.com/i.test(row.href)));
    assert.ok(events.community.some((row) => /Booker Park/i.test(row.place)));
    assert.ok(events.community.every((row) => row.host_email === undefined));
  });

  it("keeps a new news note pending until an admin approves it", async () => {
    const auth = await session();
    const res = await post(
      "/api/news",
      {
        title: "Canal water after the rain",
        body: "Stay off the banks if the water is high. Official notices stay with the water district.",
        author: "Neighbor",
      },
      auth,
    );
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.status, "pending");
    const publicNews = await (await fetch(`${base}/api/news`)).json();
    assert.ok(!publicNews.some((item) => item.id === row.id));
  });

  it("accepts a listing photo after admin review", async () => {
    const auth = await session();
    const png = solidPng(12, 8, 23, 99, 60);
    const res = await post(
      "/api/listings",
      {
        title: "Extra shade tent",
        category: "for-sale",
        description: "Pop-up tent used two Saturdays at the rummage. You pick up on Osceola.",
        price: "40",
        contact_name: "Ana",
        phone: "7725550488",
        email: "ana@example.com",
        neighborhood: "Osceola Street",
        photo: `data:image/png;base64,${png.toString("base64")}`,
      },
      auth,
    );
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.match(row.photo, /\/uploads\/listings\/\d+\.png/);
    assert.equal(row.status, "pending");

    const login = await post(
      "/api/admin/login",
      { email: "admin@indiantown.example", password: "indiantown-admin" },
      auth,
    );
    const adminCookie = [auth.cookie, login.headers.getSetCookie?.()[0] || login.headers.get("set-cookie")]
      .filter(Boolean)
      .join("; ");
    assert.equal((await post(`/api/admin/listings/${row.id}/approve`, {}, { csrf: auth.csrf, cookie: adminCookie })).status, 200);
    const photo = await fetch(`${base}${row.photo}`);
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get("content-type"), /image\/png/);
  });

  it("ships Spanish help copy on civic resources", async () => {
    const rows = await (await fetch(`${base}/api/resources`)).json();
    const library = rows.find((row) => /Lahti/i.test(row.title));
    assert.match(library.title_es, /Biblioteca/);
    assert.match(library.description_es, /Cerrado/);
    const weather = rows.find((row) => /Weather Service/i.test(row.title));
    assert.ok(weather?.url.includes("weather.gov/mlb"));
    assert.match(weather.title_es, /Meteorológico/);
  });

});
