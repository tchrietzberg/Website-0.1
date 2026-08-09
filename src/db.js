const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = process.env.DB_FILE || path.join(ROOT, 'data', 'billing.db');

function openDb(dbFile = DEFAULT_DB) {
  const dir = path.dirname(dbFile);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function migrate(db) {
  const schema = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateTimeEntryRoundingCheck(db);
  migrateMatterTypeCheck(db);
  migrateMatterClientOptional(db);
  migrateOneDriveColumns(db);
  migrateAuthColumns(db);
  migrateCustomFieldAppliesTo(db);
  migrateClientContacts(db);
  migrateContactRecordTypes(db);
  migrateContactScopedCustomFields(db);
  migrateExpandCustomFieldTypes(db);
  migrateCustomReports(db);
  migrateCustomReportChartTypes(db);
  migrateAllowInvoiceDelete(db);
  const customFields = require('./services/customFields');
  customFields.ensureRecordTypes(db);
  const matterIndex = require('./services/matterIndex');
  matterIndex.ensureMatterIndex(db);
  // Rebuild when matters exist but the index is empty or out of sync (first boot / upgrade)
  const matterCount = db.prepare('SELECT COUNT(*) AS n FROM matters').get().n;
  const idxCount = db.prepare('SELECT COUNT(*) AS n FROM matter_search_index').get().n;
  if (matterCount > 0 && idxCount !== matterCount) {
    matterIndex.reindexAllMatters(db);
  }
}

/** Saved custom reports grouped by custom fields (dashboards). */
function migrateCustomReports(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_reports (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL CHECK (source IN ('time_entry', 'matter')),
      group_by_field_id INTEGER NOT NULL REFERENCES custom_fields(id),
      metric TEXT NOT NULL CHECK (metric IN ('count', 'hours', 'amount')),
      chart_type TEXT NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'pie', 'table', 'xlsx')),
      show_on_dashboard INTEGER NOT NULL DEFAULT 1 CHECK (show_on_dashboard IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_custom_reports_active
      ON custom_reports(active, show_on_dashboard);
  `);
}

/** SQLite cannot ALTER CHECK; rebuild custom_reports when xlsx chart type is missing. */
function migrateCustomReportChartTypes(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='custom_reports'"
  ).get();
  if (!row?.sql || row.sql.includes("'xlsx'")) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE custom_reports_mig (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL CHECK (source IN ('time_entry', 'matter')),
      group_by_field_id INTEGER NOT NULL REFERENCES custom_fields(id),
      metric TEXT NOT NULL CHECK (metric IN ('count', 'hours', 'amount')),
      chart_type TEXT NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'pie', 'table', 'xlsx')),
      show_on_dashboard INTEGER NOT NULL DEFAULT 1 CHECK (show_on_dashboard IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO custom_reports_mig SELECT * FROM custom_reports;
    DROP TABLE custom_reports;
    ALTER TABLE custom_reports_mig RENAME TO custom_reports;
    CREATE INDEX IF NOT EXISTS idx_custom_reports_active
      ON custom_reports(active, show_on_dashboard);
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

function migrateAuthColumns(db) {
  const security = require('./security');
  security.ensureSessionTables(db);
  const authEmail = require('./services/authEmail');
  authEmail.ensureAuthTokenTables(db);
}

/** Matter vs time-entry custom fields + time value storage. */
function migrateCustomFieldAppliesTo(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_fields'"
  ).get();
  if (!tables) return;
  const cols = new Set(tableColumns(db, 'custom_fields'));
  if (!cols.has('applies_to')) {
    db.exec(`ALTER TABLE custom_fields ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'matter'`);
  }
  if (!cols.has('required')) {
    db.exec('ALTER TABLE custom_fields ADD COLUMN required INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.has('is_default')) {
    db.exec('ALTER TABLE custom_fields ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS time_entry_custom_field_values (
      time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES custom_fields(id),
      value_text TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_by INTEGER REFERENCES users(id),
      PRIMARY KEY (time_entry_id, field_id)
    )
  `);
  db.exec('DROP INDEX IF EXISTS idx_custom_fields_scope_name');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
      ON custom_fields(
        api_name,
        IFNULL(applies_to, 'matter'),
        IFNULL(record_type_key, ''),
        IFNULL(matter_id, 0)
      )
  `);
}

/** Contacts (= clients) columns, client custom fields, and applies_to='client'. */
function migrateClientContacts(db) {
  const clients = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='clients'"
  ).get();
  if (!clients) return;

  const cols = new Set(tableColumns(db, 'clients'));
  for (const col of ['email', 'phone', 'company', 'notes']) {
    if (!cols.has(col)) db.exec(`ALTER TABLE clients ADD COLUMN ${col} TEXT`);
  }
  if (!cols.has('updated_at')) {
    // SQLite ALTER ADD COLUMN only allows constant defaults
    db.exec(`ALTER TABLE clients ADD COLUMN updated_at TEXT`);
    db.exec(`UPDATE clients SET updated_at = IFNULL(created_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE updated_at IS NULL`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS client_custom_field_values (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES custom_fields(id),
      value_text TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_by INTEGER REFERENCES users(id),
      PRIMARY KEY (client_id, field_id)
    )
  `);

  const cfSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='custom_fields'"
  ).get()?.sql || '';
  if (cfSql && !cfSql.includes("'client'")) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      CREATE TABLE custom_fields_mig (
        id INTEGER PRIMARY KEY,
        api_name TEXT NOT NULL,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL
          CHECK (field_type IN ('text','textarea','number','date','select','checkbox')),
        options_json TEXT,
        applies_to TEXT NOT NULL DEFAULT 'matter'
          CHECK (applies_to IN ('matter','time_entry','client')),
        record_type_key TEXT REFERENCES record_types(key),
        matter_id INTEGER REFERENCES matters(id),
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (
          (applies_to = 'time_entry' AND matter_id IS NULL AND record_type_key IS NULL)
          OR (applies_to = 'client' AND matter_id IS NULL)
          OR (applies_to = 'matter' AND (
            (matter_id IS NOT NULL AND record_type_key IS NULL)
            OR (matter_id IS NULL)
          ))
        )
      );
      INSERT INTO custom_fields_mig
        SELECT id, api_name, label, field_type, options_json, applies_to, record_type_key,
               matter_id, required, 0, active, created_by, created_at
        FROM custom_fields;
      DROP TABLE custom_fields;
      ALTER TABLE custom_fields_mig RENAME TO custom_fields;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
        ON custom_fields(
          api_name,
          IFNULL(applies_to, 'matter'),
          IFNULL(record_type_key, ''),
          IFNULL(matter_id, 0)
        );
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Contact record types: record_types.applies_to, clients.record_type,
 * and custom_fields CHECK allowing type-scoped client fields.
 */
function migrateContactRecordTypes(db) {
  const rt = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='record_types'"
  ).get();
  if (rt) {
    const rtCols = new Set(tableColumns(db, 'record_types'));
    if (!rtCols.has('applies_to')) {
      db.exec(`ALTER TABLE record_types ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'matter'`);
    }
  }

  const clients = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='clients'"
  ).get();
  if (clients) {
    const cols = new Set(tableColumns(db, 'clients'));
    if (!cols.has('record_type')) {
      db.exec(`ALTER TABLE clients ADD COLUMN record_type TEXT NOT NULL DEFAULT 'client'`);
    }
  }

  const cfSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='custom_fields'"
  ).get()?.sql || '';
  // Old CHECK forced client fields to have record_type_key IS NULL.
  if (
    cfSql.includes("applies_to IN ('time_entry','client') AND matter_id IS NULL AND record_type_key IS NULL")
  ) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      CREATE TABLE custom_fields_mig (
        id INTEGER PRIMARY KEY,
        api_name TEXT NOT NULL,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL
          CHECK (field_type IN ('text','textarea','number','date','select','checkbox')),
        options_json TEXT,
        applies_to TEXT NOT NULL DEFAULT 'matter'
          CHECK (applies_to IN ('matter','time_entry','client')),
        record_type_key TEXT REFERENCES record_types(key),
        matter_id INTEGER REFERENCES matters(id),
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (
          (applies_to = 'time_entry' AND matter_id IS NULL AND record_type_key IS NULL)
          OR (applies_to = 'client' AND matter_id IS NULL)
          OR (applies_to = 'matter' AND (
            (matter_id IS NOT NULL AND record_type_key IS NULL)
            OR (matter_id IS NULL)
          ))
        )
      );
      INSERT INTO custom_fields_mig
        SELECT id, api_name, label, field_type, options_json, applies_to, record_type_key,
               matter_id, required, is_default, active, created_by, created_at
        FROM custom_fields;
      DROP TABLE custom_fields;
      ALTER TABLE custom_fields_mig RENAME TO custom_fields;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
        ON custom_fields(
          api_name,
          IFNULL(applies_to, 'matter'),
          IFNULL(record_type_key, ''),
          IFNULL(matter_id, 0)
        );
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Contact-only custom fields: custom_fields.client_id (mirrors matter_id for matters).
 * SQLite cannot ALTER CHECK; rebuild when client_id is missing.
 */
function migrateContactScopedCustomFields(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_fields'"
  ).get();
  if (!tables) return;
  const cols = new Set(tableColumns(db, 'custom_fields'));
  if (cols.has('client_id')) {
    // Ensure unique index includes client_id even if column was added earlier.
    db.exec('DROP INDEX IF EXISTS idx_custom_fields_scope_name');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
        ON custom_fields(
          api_name,
          IFNULL(applies_to, 'matter'),
          IFNULL(record_type_key, ''),
          IFNULL(matter_id, 0),
          IFNULL(client_id, 0)
        )
    `);
    return;
  }

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE custom_fields_mig (
      id INTEGER PRIMARY KEY,
      api_name TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL
        CHECK (field_type IN ('text','textarea','number','date','select','checkbox')),
      options_json TEXT,
      applies_to TEXT NOT NULL DEFAULT 'matter'
        CHECK (applies_to IN ('matter','time_entry','client')),
      record_type_key TEXT REFERENCES record_types(key),
      matter_id INTEGER REFERENCES matters(id),
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK (
        (applies_to = 'time_entry' AND matter_id IS NULL AND client_id IS NULL AND record_type_key IS NULL)
        OR (applies_to = 'client' AND matter_id IS NULL AND (
          (client_id IS NOT NULL AND record_type_key IS NULL)
          OR (client_id IS NULL)
        ))
        OR (applies_to = 'matter' AND client_id IS NULL AND (
          (matter_id IS NOT NULL AND record_type_key IS NULL)
          OR (matter_id IS NULL)
        ))
      )
    );
    INSERT INTO custom_fields_mig (
      id, api_name, label, field_type, options_json, applies_to, record_type_key,
      matter_id, client_id, required, is_default, active, created_by, created_at
    )
      SELECT id, api_name, label, field_type, options_json, applies_to, record_type_key,
             matter_id, NULL, required, is_default, active, created_by, created_at
      FROM custom_fields;
    DROP TABLE custom_fields;
    ALTER TABLE custom_fields_mig RENAME TO custom_fields;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
      ON custom_fields(
        api_name,
        IFNULL(applies_to, 'matter'),
        IFNULL(record_type_key, ''),
        IFNULL(matter_id, 0),
        IFNULL(client_id, 0)
      );
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

/**
 * Expand custom_fields.field_type CHECK to Salesforce-style types
 * (excludes roll-up, lookup, master-detail).
 */
function migrateExpandCustomFieldTypes(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_fields'"
  ).get();
  if (!tables) return;
  const cfSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='custom_fields'"
  ).get()?.sql || '';
  if (cfSql.includes("'auto_number'") && cfSql.includes("'formula'")) return;

  const cols = new Set(tableColumns(db, 'custom_fields'));
  const hasClientId = cols.has('client_id');

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE custom_fields_mig (
      id INTEGER PRIMARY KEY,
      api_name TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL
        CHECK (field_type IN (
          'text','textarea','long_text','rich_text','number','currency','percent',
          'date','datetime','email','phone','url','checkbox','select','multiselect',
          'auto_number','geolocation','formula'
        )),
      options_json TEXT,
      applies_to TEXT NOT NULL DEFAULT 'matter'
        CHECK (applies_to IN ('matter','time_entry','client')),
      record_type_key TEXT REFERENCES record_types(key),
      matter_id INTEGER REFERENCES matters(id),
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK (
        (applies_to = 'time_entry' AND matter_id IS NULL AND client_id IS NULL AND record_type_key IS NULL)
        OR (applies_to = 'client' AND matter_id IS NULL AND (
          (client_id IS NOT NULL AND record_type_key IS NULL)
          OR (client_id IS NULL)
        ))
        OR (applies_to = 'matter' AND client_id IS NULL AND (
          (matter_id IS NOT NULL AND record_type_key IS NULL)
          OR (matter_id IS NULL)
        ))
      )
    );
  `);
  if (hasClientId) {
    db.exec(`
      INSERT INTO custom_fields_mig (
        id, api_name, label, field_type, options_json, applies_to, record_type_key,
        matter_id, client_id, required, is_default, active, created_by, created_at
      )
      SELECT id, api_name, label, field_type, options_json, applies_to, record_type_key,
             matter_id, client_id, required, is_default, active, created_by, created_at
      FROM custom_fields;
    `);
  } else {
    db.exec(`
      INSERT INTO custom_fields_mig (
        id, api_name, label, field_type, options_json, applies_to, record_type_key,
        matter_id, client_id, required, is_default, active, created_by, created_at
      )
      SELECT id, api_name, label, field_type, options_json, applies_to, record_type_key,
             matter_id, NULL, required, is_default, active, created_by, created_at
      FROM custom_fields;
    `);
  }
  db.exec(`
    DROP TABLE custom_fields;
    ALTER TABLE custom_fields_mig RENAME TO custom_fields;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
      ON custom_fields(
        api_name,
        IFNULL(applies_to, 'matter'),
        IFNULL(record_type_key, ''),
        IFNULL(matter_id, 0),
        IFNULL(client_id, 0)
      );
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrateOneDriveColumns(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='matter_onedrive'"
  ).get();
  if (!tables) return;
  const cols = new Set(tableColumns(db, 'matter_onedrive'));
  if (!cols.has('last_synced_at')) {
    db.exec('ALTER TABLE matter_onedrive ADD COLUMN last_synced_at TEXT');
  }
  if (!cols.has('last_sync_error')) {
    db.exec('ALTER TABLE matter_onedrive ADD COLUMN last_sync_error TEXT');
  }
}

/** Allow matters without a client (associate optionally on create/edit). */
function migrateMatterClientOptional(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='matters'"
  ).get();
  if (!row?.sql || !/client_id\s+INTEGER\s+NOT NULL/i.test(row.sql)) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE matters_client_opt (
      id INTEGER PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id),
      number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      matter_type TEXT NOT NULL DEFAULT 'billable',
      jurisdiction TEXT,
      court TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      responsible_attorney_id INTEGER REFERENCES users(id),
      opened_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO matters_client_opt(
      id, client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on, created_at
    )
    SELECT
      id, client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on, created_at
    FROM matters;
    DROP TABLE matters;
    ALTER TABLE matters_client_opt RENAME TO matters;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

/** SQLite cannot ALTER CHECK; drop matters.matter_type enum so Billable remaps work. */
function migrateMatterTypeCheck(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='matters'"
  ).get();
  if (!row?.sql || !row.sql.includes("matter_type IN ('litigation'")) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE matters_mig (
      id INTEGER PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id),
      number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      matter_type TEXT NOT NULL DEFAULT 'billable',
      jurisdiction TEXT,
      court TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      responsible_attorney_id INTEGER REFERENCES users(id),
      opened_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO matters_mig(
      id, client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on, created_at
    )
    SELECT
      id, client_id, number, name,
      CASE
        WHEN matter_type IN ('litigation','sw_admin','other','default') THEN 'billable'
        ELSE matter_type
      END,
      jurisdiction, court, status,
      responsible_attorney_id, opened_on, created_at
    FROM matters;
    DROP TABLE matters;
    ALTER TABLE matters_mig RENAME TO matters;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

/** Allow deleting bills from the ledger (time entries are unlinked by the service). */
function migrateAllowInvoiceDelete(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS invoices_no_delete;
    DROP TRIGGER IF EXISTS invoice_lines_sent_no_delete;
  `);
}

/** SQLite cannot ALTER CHECK; rebuild time_entries if still on rounded_minutes > 0. */
function migrateTimeEntryRoundingCheck(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entries'"
  ).get();
  if (!row?.sql || !row.sql.includes('rounded_minutes > 0')) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE time_entries_mig (
      id INTEGER PRIMARY KEY,
      matter_id INTEGER NOT NULL REFERENCES matters(id),
      timekeeper_id INTEGER NOT NULL REFERENCES users(id),
      service_date TEXT NOT NULL,
      entered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      raw_minutes INTEGER NOT NULL CHECK (raw_minutes > 0),
      rounded_minutes INTEGER NOT NULL CHECK (rounded_minutes >= 0),
      description TEXT NOT NULL,
      billable INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0,1)),
      category TEXT,
      subcategory TEXT,
      utbms_task TEXT,
      utbms_activity TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','submitted','approved','rejected','invoiced')),
      rejection_reason TEXT,
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      invoice_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO time_entries_mig SELECT * FROM time_entries;
    DROP TABLE time_entries;
    ALTER TABLE time_entries_mig RENAME TO time_entries;
    CREATE INDEX IF NOT EXISTS idx_time_entries_matter_date
      ON time_entries(matter_id, service_date, timekeeper_id);
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

function resetDb(dbFile = DEFAULT_DB) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbFile + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const db = openDb(dbFile);
  migrate(db);
  return db;
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM firm_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO firm_settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function audit(db, { actorId, action, entityType, entityId = null, detail = null }) {
  db.prepare(`
    INSERT INTO audit_log(actor_id, action, entity_type, entity_id, detail_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId ?? null, action, entityType, entityId, detail ? JSON.stringify(detail) : null);
}

function allocateNumber(db, name, year, prefix) {
  const existing = db.prepare(
    'SELECT next_value FROM number_counters WHERE name = ? AND year = ?'
  ).get(name, year);
  let n;
  if (!existing) {
    db.prepare('INSERT INTO number_counters(name, year, next_value) VALUES (?, ?, 2)')
      .run(name, year);
    n = 1;
  } else {
    n = existing.next_value;
    db.prepare('UPDATE number_counters SET next_value = next_value + 1 WHERE name = ? AND year = ?')
      .run(name, year);
  }
  return `${prefix}${year}-${String(n).padStart(4, '0')}`;
}

module.exports = {
  ROOT,
  DEFAULT_DB,
  openDb,
  migrate,
  resetDb,
  getSetting,
  setSetting,
  audit,
  allocateNumber,
};
