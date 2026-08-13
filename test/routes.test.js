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
});
