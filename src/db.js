import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function openDb(file = process.env.DB_FILE || join(root, "data", "indiantown.db")) {
  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  const schema = readFileSync(join(root, "db", "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

export function isEmpty(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM resources").get();
  return row.n === 0;
}
