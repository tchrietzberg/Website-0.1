import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMailto, validateContact } from "../src/contact.js";

describe("validateContact", () => {
  it("accepts a complete note", () => {
    const result = validateContact({
      name: "Alex Rivera",
      email: "alex@example.com",
      message: "Can we talk about a billing prototype?",
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.name, "Alex Rivera");
  });

  it("rejects a short name", () => {
    const result = validateContact({
      name: "A",
      email: "alex@example.com",
      message: "Long enough message here",
    });
    assert.equal(result.ok, false);
    assert.equal(result.field, "name");
  });

  it("rejects a bad email", () => {
    const result = validateContact({
      name: "Alex",
      email: "not-an-email",
      message: "Long enough message here",
    });
    assert.equal(result.ok, false);
    assert.equal(result.field, "email");
  });

  it("rejects a thin message", () => {
    const result = validateContact({
      name: "Alex",
      email: "alex@example.com",
      message: "Hi",
    });
    assert.equal(result.ok, false);
    assert.equal(result.field, "message");
  });
});

describe("buildMailto", () => {
  it("encodes the draft for the site inbox", () => {
    const href = buildMailto({
      name: "Alex Rivera",
      email: "alex@example.com",
      message: "Let's talk",
    });
    assert.match(href, /^mailto:tchrietzberg@gmail.com\?/);
    assert.match(href, /Website%200\.1/);
    assert.match(href, /alex%40example.com/);
  });
});
