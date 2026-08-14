const APPROVED = "approved";

function listingWhere(category, status = APPROVED) {
  const parts = ["status = ?"];
  const args = [status];
  if (category) {
    parts.push("category = ?");
    args.push(category);
  }
  return { sql: parts.join(" AND "), args };
}

export function listListings(db, category, status = APPROVED) {
  const { sql, args } = listingWhere(category, status);
  return db
    .prepare(`SELECT * FROM listings WHERE ${sql} ORDER BY created_at DESC, id DESC`)
    .all(...args);
}

export function getListing(db, id) {
  return db.prepare("SELECT * FROM listings WHERE id = ?").get(id) ?? null;
}

export function createListing(db, row) {
  const result = db
    .prepare(
      `INSERT INTO listings
        (title, category, description, price_cents, contact_name, phone, email, neighborhood, photo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      row.title,
      row.category,
      row.description,
      row.price_cents,
      row.contact_name,
      row.phone,
      row.email,
      row.neighborhood,
      row.photo || null,
    );
  return getListing(db, result.lastInsertRowid);
}

export function setListingPhoto(db, id, photo) {
  db.prepare("UPDATE listings SET photo = ? WHERE id = ?").run(photo, id);
  return getListing(db, id);
}

export function setListingStatus(db, id, status) {
  db.prepare("UPDATE listings SET status = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, id);
  return getListing(db, id);
}

export function listBusinesses(db, category) {
  if (category) {
    return db
      .prepare("SELECT * FROM businesses WHERE category = ? ORDER BY name COLLATE NOCASE")
      .all(category);
  }
  return db.prepare("SELECT * FROM businesses ORDER BY name COLLATE NOCASE").all();
}

export function getBusiness(db, id) {
  return db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) ?? null;
}

export function createBusiness(db, row) {
  const result = db
    .prepare(
      `INSERT INTO businesses
        (name, category, description, owner_name, phone, email, website, address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.name,
      row.category,
      row.description,
      row.owner_name,
      row.phone,
      row.email,
      row.website,
      row.address,
    );
  return getBusiness(db, result.lastInsertRowid);
}

export function listNews(db, status = APPROVED) {
  return db.prepare("SELECT * FROM news WHERE status = ? ORDER BY created_at DESC, id DESC").all(status);
}

export function getNews(db, id) {
  return db.prepare("SELECT * FROM news WHERE id = ?").get(id) ?? null;
}

export function createNews(db, row) {
  const result = db
    .prepare("INSERT INTO news (title, body, author, status) VALUES (?, ?, ?, 'pending')")
    .run(row.title, row.body, row.author);
  return getNews(db, result.lastInsertRowid);
}

export function setNewsStatus(db, id, status) {
  db.prepare("UPDATE news SET status = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, id);
  return getNews(db, id);
}

export function listEvents(db, status = APPROVED) {
  return db
    .prepare("SELECT * FROM events WHERE status = ? ORDER BY starts_on ASC, id ASC")
    .all(status);
}

export function getEvent(db, id) {
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id) ?? null;
}

export function createEvent(db, row) {
  const result = db
    .prepare(
      `INSERT INTO events (title, body, place, starts_on, host_name, host_email, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(row.title, row.body, row.place, row.starts_on, row.host_name, row.host_email);
  return getEvent(db, result.lastInsertRowid);
}

export function setEventStatus(db, id, status) {
  db.prepare("UPDATE events SET status = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, id);
  return getEvent(db, id);
}

export function publicEvent(row) {
  if (!row) return null;
  const { host_email, ...rest } = row;
  return rest;
}

const RESOURCE_ORDER = `CASE category
  WHEN 'safety' THEN 0
  WHEN 'government' THEN 1
  WHEN 'utilities' THEN 2
  WHEN 'schools' THEN 3
  WHEN 'health' THEN 4
  WHEN 'help' THEN 5
  WHEN 'parks' THEN 6
  ELSE 7
END, title COLLATE NOCASE`;

export function listResources(db, category) {
  if (category) {
    return db
      .prepare(`SELECT * FROM resources WHERE category = ? ORDER BY title COLLATE NOCASE`)
      .all(category);
  }
  return db.prepare(`SELECT * FROM resources ORDER BY ${RESOURCE_ORDER}`).all();
}

export function stats(db) {
  return {
    listings: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'approved'").get().n,
    businesses: db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n,
    news: db.prepare("SELECT COUNT(*) AS n FROM news WHERE status = 'approved'").get().n,
    resources: db.prepare("SELECT COUNT(*) AS n FROM resources").get().n,
    rooms: db.prepare("SELECT COUNT(*) AS n FROM rooms WHERE status = 'approved'").get().n,
    events: db.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'approved'").get().n,
  };
}

export function listReviewQueue(db) {
  return {
    listings: db
      .prepare("SELECT * FROM listings WHERE status = 'pending' ORDER BY created_at DESC, id DESC")
      .all(),
    news: db.prepare("SELECT * FROM news WHERE status = 'pending' ORDER BY created_at DESC, id DESC").all(),
    events: db.prepare("SELECT * FROM events WHERE status = 'pending' ORDER BY starts_on ASC, id ASC").all(),
  };
}

export function searchAll(db, query) {
  const q = String(query || "")
    .trim()
    .slice(0, 80)
    .replace(/[%_]/g, "");
  if (q.length < 2) return { listings: [], businesses: [], news: [], resources: [], rooms: [], events: [] };
  const like = `%${q}%`;
  return {
    listings: db
      .prepare(
        `SELECT id, title, category, description, price_cents, neighborhood, photo, created_at
         FROM listings
         WHERE status = 'approved' AND (title LIKE ? OR description LIKE ? OR neighborhood LIKE ?)
         ORDER BY created_at DESC LIMIT 20`,
      )
      .all(like, like, like),
    businesses: db
      .prepare(
        `SELECT id, name, category, description, address, website, created_at
         FROM businesses
         WHERE name LIKE ? OR description LIKE ? OR address LIKE ?
         ORDER BY name COLLATE NOCASE LIMIT 20`,
      )
      .all(like, like, like),
    news: db
      .prepare(
        `SELECT id, title, body, author, created_at FROM news
         WHERE status = 'approved' AND (title LIKE ? OR body LIKE ?) ORDER BY created_at DESC LIMIT 10`,
      )
      .all(like, like),
    resources: db
      .prepare(
        `SELECT id, title, title_es, category, description, description_es, url, phone, address FROM resources
         WHERE title LIKE ? OR description LIKE ? OR title_es LIKE ? OR description_es LIKE ? LIMIT 10`,
      )
      .all(like, like, like, like),
    rooms: db
      .prepare(
        `SELECT id, title, topic, description, host_name, status, created_at
         FROM rooms WHERE status = 'approved' AND (title LIKE ? OR description LIKE ?)
         LIMIT 10`,
      )
      .all(like, like),
    events: db
      .prepare(
        `SELECT id, title, body, place, starts_on, host_name, status, created_at FROM events
         WHERE status = 'approved' AND (title LIKE ? OR body LIKE ? OR place LIKE ?)
         ORDER BY starts_on ASC LIMIT 10`,
      )
      .all(like, like, like),
  };
}
