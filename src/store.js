export function listListings(db, category) {
  if (category) {
    return db
      .prepare("SELECT * FROM listings WHERE category = ? ORDER BY created_at DESC, id DESC")
      .all(category);
  }
  return db.prepare("SELECT * FROM listings ORDER BY created_at DESC, id DESC").all();
}

export function getListing(db, id) {
  return db.prepare("SELECT * FROM listings WHERE id = ?").get(id) ?? null;
}

export function createListing(db, row) {
  const result = db
    .prepare(
      `INSERT INTO listings
        (title, category, description, price_cents, contact_name, phone, email, neighborhood)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  return getListing(db, result.lastInsertRowid);
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

export function listNews(db) {
  return db.prepare("SELECT * FROM news ORDER BY created_at DESC, id DESC").all();
}

export function createNews(db, row) {
  const result = db
    .prepare("INSERT INTO news (title, body, author) VALUES (?, ?, ?)")
    .run(row.title, row.body, row.author);
  return db.prepare("SELECT * FROM news WHERE id = ?").get(result.lastInsertRowid);
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
    listings: db.prepare("SELECT COUNT(*) AS n FROM listings").get().n,
    businesses: db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n,
    news: db.prepare("SELECT COUNT(*) AS n FROM news").get().n,
    resources: db.prepare("SELECT COUNT(*) AS n FROM resources").get().n,
    rooms: db.prepare("SELECT COUNT(*) AS n FROM rooms WHERE status = 'approved'").get().n,
  };
}

export function searchAll(db, query) {
  const q = String(query || "")
    .trim()
    .slice(0, 80)
    .replace(/[%_]/g, "");
  if (q.length < 2) return { listings: [], businesses: [], news: [], resources: [], rooms: [] };
  const like = `%${q}%`;
  return {
    listings: db
      .prepare(
        `SELECT id, title, category, description, price_cents, neighborhood, created_at
         FROM listings
         WHERE title LIKE ? OR description LIKE ? OR neighborhood LIKE ?
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
         WHERE title LIKE ? OR body LIKE ? ORDER BY created_at DESC LIMIT 10`,
      )
      .all(like, like),
    resources: db
      .prepare(
        `SELECT id, title, category, description, url, phone, address FROM resources
         WHERE title LIKE ? OR description LIKE ? LIMIT 10`,
      )
      .all(like, like),
    rooms: db
      .prepare(
        `SELECT id, title, topic, description, host_name, status, created_at
         FROM rooms WHERE status = 'approved' AND (title LIKE ? OR description LIKE ?)
         LIMIT 10`,
      )
      .all(like, like),
  };
}
