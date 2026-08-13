import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBusiness, validateListing, validateNews } from "../src/validate.js";

describe("validateListing", () => {
  const good = {
    title: "Used fridge, works",
    category: "for-sale",
    description: "Clean fridge from a house on Osceola. You haul.",
    price: "75",
    contact_name: "Ana",
    phone: "(772) 555-0100",
    email: "ana@example.com",
    neighborhood: "Osceola Street",
  };

  it("accepts a complete listing and stores cents", () => {
    const result = validateListing(good);
    assert.equal(result.ok, true);
    assert.equal(result.value.price_cents, 7500);
  });

  it("rejects an unknown category", () => {
    const result = validateListing({ ...good, category: "legal-billing" });
    assert.equal(result.ok, false);
    assert.equal(result.field, "category");
  });

  it("rejects a thin description", () => {
    const result = validateListing({ ...good, description: "hi" });
    assert.equal(result.ok, false);
  });
});

describe("validateBusiness", () => {
  it("requires a real email and street address", () => {
    const result = validateBusiness({
      name: "Canal Cafe",
      category: "food",
      description: "Coffee and sandwiches near Village Hall.",
      owner_name: "Sam",
      phone: "772-555-0199",
      email: "not-valid",
      website: "",
      address: "15516 SW Osceola St",
    });
    assert.equal(result.ok, false);
    assert.equal(result.field, "email");
  });

  it("accepts a company with contact information", () => {
    const result = validateBusiness({
      name: "Canal Cafe",
      category: "food",
      description: "Coffee and sandwiches near Village Hall.",
      owner_name: "Sam Lee",
      phone: "772-555-0199",
      email: "sam@canalcafe.example",
      website: "https://canalcafe.example",
      address: "15516 SW Osceola St, Indiantown, FL 34956",
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.email, "sam@canalcafe.example");
  });
});

describe("validateNews", () => {
  it("accepts a community note", () => {
    const result = validateNews({
      title: "Park cleanup Saturday",
      body: "Bring gloves and water. Meet at the Booker Park pavilion at 8 a.m.",
      author: "Neighbors",
    });
    assert.equal(result.ok, true);
  });
});
