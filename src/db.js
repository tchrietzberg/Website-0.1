import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./security.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function openDb(file = process.env.DB_FILE || join(root, "data", "indiantown.db")) {
  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");
  db.exec(schema);
  ensureAdmin(db);
  return db;
}

export function ensureAdmin(
  db,
  {
    email = process.env.ADMIN_EMAIL || "admin@indiantown.example",
    password = process.env.ADMIN_PASSWORD || "indiantown-admin",
  } = {},
) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM admins").get().n;
  if (n > 0) return;
  db.prepare("INSERT INTO admins (email, password_hash) VALUES (?, ?)").run(
    email.toLowerCase(),
    hashPassword(password),
  );
}

export function isEmpty(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM resources").get();
  return row.n === 0;
}

export function needsChatSeed(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM rooms").get();
  return row.n === 0;
}
