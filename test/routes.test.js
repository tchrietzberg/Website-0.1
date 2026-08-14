import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHash } from "../src/web/public/routes.js";

describe("parseHash", () => {
  it("opens a listing from #/listing/7", () => {
    assert.deepEqual(parseHash("#/listing/7"), { page: "listing", id: "7" });
  });

  it("opens home from an empty hash", () => {
    assert.deepEqual(parseHash("#/"), { page: "", id: "" });
  });

  it("opens the board", () => {
    assert.deepEqual(parseHash("#/board"), { page: "board", id: "" });
  });

  it("opens a chat room", () => {
    assert.deepEqual(parseHash("#/chat/2"), { page: "chat", id: "2" });
  });

  it("opens a news story", () => {
    assert.deepEqual(parseHash("#/news/3"), { page: "news", id: "3" });
  });

  it("opens homes", () => {
    assert.deepEqual(parseHash("#/homes"), { page: "homes", id: "" });
  });

  it("opens about", () => {
    assert.deepEqual(parseHash("#/about"), { page: "about", id: "" });
  });

  it("opens facebook", () => {
    assert.deepEqual(parseHash("#/facebook"), { page: "facebook", id: "" });
  });
});
