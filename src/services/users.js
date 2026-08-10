const { audit } = require('../db');
const { hashPassword, destroyUserSessions } = require('../security');

function listUsers(db, { includeInactive = false } = {}) {
  if (includeInactive) {
    return db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY name').all();
  }
  return db.prepare(
    'SELECT id, email, name, role, active, created_at FROM users WHERE active = 1 ORDER BY name'
  ).all();
}

function createUser(db, actor, input) {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const role = input.role || 'attorney';
  const password = input.password;
  if (!email || !email.includes('@')) throw new Error('valid email required');
  if (!name) throw new Error('name required');
  const permissions = require('./permissions');
  if (!permissions.isKnownRole(db, role)) {
    throw new Error('invalid role');
  }
  if (!password) throw new Error('password required');
  const passwordHash = hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) throw new Error('email already exists');

  const info = db.prepare(
    'INSERT INTO users(email, name, role, password_hash, active) VALUES (?, ?, ?, ?, 1)'
  ).run(email, name, role, passwordHash);
  const id = Number(info.lastInsertRowid);

  audit(db, {
    actorId: actor.id,
    action: 'user.create',
    entityType: 'user',
    entityId: id,
    detail: { email, name, role },
  });

  return db.prepare(
    'SELECT id, email, name, role, active, created_at FROM users WHERE id = ?'
  ).get(id);
}

function setUserPassword(db, actor, id, password) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('user not found');
  const passwordHash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  destroyUserSessions(db, id);
  audit(db, {
    actorId: actor.id,
    action: 'user.password_set',
    entityType: 'user',
    entityId: id,
  });
  return { ok: true };
}

function setUserActive(db, actor, id, active) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('user not found');
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (!active) destroyUserSessions(db, id);
  audit(db, {
    actorId: actor.id,
    action: active ? 'user.activate' : 'user.deactivate',
    entityType: 'user',
    entityId: id,
  });
  return db.prepare(
    'SELECT id, email, name, role, active, created_at FROM users WHERE id = ?'
  ).get(id);
}

module.exports = { listUsers, createUser, setUserActive, setUserPassword };
