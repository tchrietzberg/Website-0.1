#!/usr/bin/env node
const { resetDb, DEFAULT_DB } = require('../src/db');
const { hashPassword } = require('../src/security');
const places = require('../src/places');

const dbFile = process.env.DB_FILE || DEFAULT_DB;
const db = resetDb(dbFile);
const demoPassword = process.env.DEMO_PASSWORD || 'pinpoint-demo-1';
const passwordHash = hashPassword(demoPassword);

const users = [
  ['alex@pinpoint.test', 'Alex Rivera'],
  ['jordan@pinpoint.test', 'Jordan Lee'],
  ['riley@pinpoint.test', 'Riley Chen'],
];
for (const [email, name] of users) {
  db.prepare('INSERT INTO users(email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, passwordHash);
}

places.seedDemo(db);
console.log(`Seeded ${dbFile}`);
console.log('Demo logins (password for all):', demoPassword);
console.log('  alex@pinpoint.test');
console.log('  jordan@pinpoint.test');
console.log('  riley@pinpoint.test');
