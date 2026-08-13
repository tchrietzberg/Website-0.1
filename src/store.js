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

export function listResources(db) {
  return db.prepare("SELECT * FROM resources ORDER BY category, title COLLATE NOCASE").all();
}

export function stats(db) {
  return {
    listings: db.prepare("SELECT COUNT(*) AS n FROM listings").get().n,
    businesses: db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n,
    news: db.prepare("SELECT COUNT(*) AS n FROM news").get().n,
    resources: db.prepare("SELECT COUNT(*) AS n FROM resources").get().n,
  };
}
