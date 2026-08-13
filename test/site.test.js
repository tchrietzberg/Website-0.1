import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const pages = ["index.html", "work.html", "about.html", "contact.html"];

describe("site pages", () => {
  it("keeps the four public pages linked together", async () => {
    for (const page of pages) {
      const html = await readFile(join(root, page), "utf8");
      assert.match(html, /<title>.+<\/title>/);
      assert.match(html, /href="\/work.html"/);
      assert.match(html, /href="\/about.html"/);
      assert.match(html, /href="\/contact.html"/);
      assert.match(html, /Skip to content/);
    }
  });

  it("names the person on the home page", async () => {
    const html = await readFile(join(root, "index.html"), "utf8");
    assert.match(html, /T\. Chrietzberg/);
    assert.match(html, /Software that earns its keep/);
  });

  it("keeps a contact path that does not require a server", async () => {
    const html = await readFile(join(root, "contact.html"), "utf8");
    assert.match(html, /data-contact-form/);
    assert.match(html, /mailto:tchrietzberg@gmail.com/);
  });
});

describe("production build", () => {
  it("emits the public pages into dist", async () => {
    const files = await readdir(join(root, "dist"));
    for (const page of pages) {
      assert.ok(files.includes(page), `missing ${page} in dist`);
    }
  });
});
