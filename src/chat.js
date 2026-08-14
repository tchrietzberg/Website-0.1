export function publicRoom(row) {
  if (!row) return null;
  const { host_email, ...rest } = row;
  return rest;
}

export function listApprovedRooms(db, topic) {
  if (topic) {
    return db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id AND m.hidden = 0) AS message_count
         FROM rooms r WHERE r.status = 'approved' AND r.topic = ?
         ORDER BY r.created_at DESC`,
      )
      .all(topic)
      .map(publicRoom);
  }
  return db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id AND m.hidden = 0) AS message_count
       FROM rooms r WHERE r.status = 'approved'
       ORDER BY r.created_at DESC`,
    )
    .all()
    .map(publicRoom);
}

export function listAllRooms(db) {
  return db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) AS message_count
       FROM rooms r ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, r.created_at DESC`,
    )
    .all();
}

export function getRoom(db, id) {
  return db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) ?? null;
}

export function createRoom(db, row) {
  const result = db
    .prepare(
      `INSERT INTO rooms (title, topic, description, host_name, host_email, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    )
    .run(row.title, row.topic, row.description, row.host_name, row.host_email);
  return getRoom(db, result.lastInsertRowid);
}

export function setRoomStatus(db, id, status) {
  db.prepare("UPDATE rooms SET status = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, id);
  return getRoom(db, id);
}

export function listMessages(db, roomId, { includeHidden = false } = {}) {
  if (includeHidden) {
    return db
      .prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY id ASC")
      .all(roomId);
  }
  return db
    .prepare("SELECT * FROM messages WHERE room_id = ? AND hidden = 0 ORDER BY id ASC")
    .all(roomId);
}

export function createMessage(db, roomId, row) {
  const result = db
    .prepare("INSERT INTO messages (room_id, author, body) VALUES (?, ?, ?)")
    .run(roomId, row.author, row.body);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid);
}

export function hideMessage(db, id) {
  db.prepare("UPDATE messages SET hidden = 1 WHERE id = ?").run(id);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) ?? null;
}

export function searchRooms(db, like) {
  return db
    .prepare(
      `SELECT id, title, topic, description, host_name, status, created_at
       FROM rooms WHERE status = 'approved' AND (title LIKE ? OR description LIKE ?)
       LIMIT 10`,
    )
    .all(like, like);
}

export function roomStats(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM rooms WHERE status = 'approved'").get().n;
}

export function findAdmin(db, email) {
  return db.prepare("SELECT * FROM admins WHERE email = ?").get(String(email || "").toLowerCase()) ?? null;
}
