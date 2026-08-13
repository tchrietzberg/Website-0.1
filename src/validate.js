const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\s-]{7,20}$/;
const URL = /^https?:\/\/.+/i;

export const LISTING_CATEGORIES = [
  "for-sale",
  "wanted",
  "jobs",
  "housing",
  "services",
  "community",
];

export const BUSINESS_CATEGORIES = [
  "food",
  "trades",
  "auto",
  "health",
  "retail",
  "farm",
  "care",
  "other",
];

export const ROOM_TOPICS = [
  "community",
  "events",
  "jobs",
  "housing",
  "help",
  "youth",
  "spanish",
  "other",
];

export const RESOURCE_CATEGORIES = [
  "safety",
  "government",
  "utilities",
  "schools",
  "health",
  "help",
  "parks",
];

function trim(value) {
  return String(value ?? "").trim();
}

function requireText(value, field, { min = 2, max = 400 } = {}) {
  const text = trim(value);
  if (text.length < min) return { ok: false, field, error: `${field} is too short.` };
  if (text.length > max) return { ok: false, field, error: `${field} is too long.` };
  return { ok: true, value: text };
}

function requireEmail(value) {
  const email = trim(value).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, field: "email", error: "Use a valid email." };
  return { ok: true, value: email };
}

function requirePhone(value) {
  const phone = trim(value);
  if (!PHONE.test(phone)) return { ok: false, field: "phone", error: "Use a valid phone number." };
  return { ok: true, value: phone };
}

function optionalUrl(value) {
  const url = trim(value);
  if (!url) return { ok: true, value: "" };
  if (!URL.test(url)) return { ok: false, field: "website", error: "Website must start with http:// or https://." };
  return { ok: true, value: url };
}

function parsePrice(value) {
  if (value === "" || value == null) return { ok: true, value: null };
  const raw = String(value).replace(/[$,\s]/g, "");
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { ok: false, field: "price", error: "Price must be a number." };
  }
  return { ok: true, value: Math.round(dollars * 100) };
}

export function validateListing(input) {
  const title = requireText(input.title, "title", { min: 4, max: 80 });
  if (!title.ok) return title;
  const category = trim(input.category);
  if (!LISTING_CATEGORIES.includes(category)) {
    return { ok: false, field: "category", error: "Pick a listing category." };
  }
  const description = requireText(input.description, "description", { min: 12, max: 2000 });
  if (!description.ok) return description;
  const price = parsePrice(input.price);
  if (!price.ok) return price;
  const contact_name = requireText(input.contact_name, "contact_name", { min: 2, max: 80 });
  if (!contact_name.ok) return contact_name;
  const phone = requirePhone(input.phone);
  if (!phone.ok) return phone;
  const email = requireEmail(input.email);
  if (!email.ok) return email;
  const neighborhood = requireText(input.neighborhood, "neighborhood", { min: 2, max: 80 });
  if (!neighborhood.ok) return neighborhood;

  return {
    ok: true,
    value: {
      title: title.value,
      category,
      description: description.value,
      price_cents: price.value,
      contact_name: contact_name.value,
      phone: phone.value,
      email: email.value,
      neighborhood: neighborhood.value,
    },
  };
}

export function validateBusiness(input) {
  const name = requireText(input.name, "name", { min: 2, max: 80 });
  if (!name.ok) return name;
  const category = trim(input.category);
  if (!BUSINESS_CATEGORIES.includes(category)) {
    return { ok: false, field: "category", error: "Pick a business category." };
  }
  const description = requireText(input.description, "description", { min: 12, max: 2000 });
  if (!description.ok) return description;
  const owner_name = requireText(input.owner_name, "owner_name", { min: 2, max: 80 });
  if (!owner_name.ok) return owner_name;
  const phone = requirePhone(input.phone);
  if (!phone.ok) return phone;
  const email = requireEmail(input.email);
  if (!email.ok) return email;
  const website = optionalUrl(input.website);
  if (!website.ok) return website;
  const address = requireText(input.address, "address", { min: 6, max: 160 });
  if (!address.ok) return address;

  return {
    ok: true,
    value: {
      name: name.value,
      category,
      description: description.value,
      owner_name: owner_name.value,
      phone: phone.value,
      email: email.value,
      website: website.value,
      address: address.value,
    },
  };
}

export function validateNews(input) {
  const title = requireText(input.title, "title", { min: 6, max: 120 });
  if (!title.ok) return title;
  const body = requireText(input.body, "body", { min: 20, max: 4000 });
  if (!body.ok) return body;
  const author = requireText(input.author, "author", { min: 2, max: 80 });
  if (!author.ok) return author;
  return { ok: true, value: { title: title.value, body: body.value, author: author.value } };
}

export function validateRoom(input) {
  const title = requireText(input.title, "title", { min: 4, max: 80 });
  if (!title.ok) return title;
  const topic = trim(input.topic);
  if (!ROOM_TOPICS.includes(topic)) {
    return { ok: false, field: "topic", error: "Pick a chat topic." };
  }
  const description = requireText(input.description, "description", { min: 12, max: 800 });
  if (!description.ok) return description;
  const host_name = requireText(input.host_name, "host_name", { min: 2, max: 80 });
  if (!host_name.ok) return host_name;
  const host_email = requireEmail(input.host_email || input.email);
  if (!host_email.ok) return { ...host_email, field: "host_email" };
  return {
    ok: true,
    value: {
      title: title.value,
      topic,
      description: description.value,
      host_name: host_name.value,
      host_email: host_email.value,
    },
  };
}

export function validateMessage(input) {
  const author = requireText(input.author, "author", { min: 2, max: 40 });
  if (!author.ok) return author;
  const body = requireText(input.body, "body", { min: 1, max: 500 });
  if (!body.ok) return body;
  return { ok: true, value: { author: author.value, body: body.value } };
}
