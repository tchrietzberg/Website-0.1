#!/usr/bin/env node
const { resetDb, DEFAULT_DB } = require('../src/db');
const { hashPassword } = require('../src/security');
const stamps = require('../src/stamps');

const dbFile = process.env.DB_FILE || DEFAULT_DB;
const db = resetDb(dbFile);
const demoPassword = process.env.DEMO_PASSWORD || 'waymark-demo-1';
const passwordHash = hashPassword(demoPassword);

const users = [
  ['maya@waymark.test', 'Maya Chen'],
  ['chris@waymark.test', 'Chris Alvarez'],
  ['priya@waymark.test', 'Priya Shah'],
];
for (const [email, name] of users) {
  db.prepare('INSERT INTO users(email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, passwordHash);
}

stamps.seedDemo(db);
console.log(`Seeded ${dbFile}`);
console.log('Demo logins (password for all):', demoPassword);
console.log('  maya@waymark.test');
console.log('  chris@waymark.test');
console.log('  priya@waymark.test');
