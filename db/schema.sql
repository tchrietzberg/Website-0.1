PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS firm_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','attorney','paralegal','billing_clerk')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS matters (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  matter_type TEXT NOT NULL DEFAULT 'default',
  jurisdiction TEXT,
  court TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  responsible_attorney_id INTEGER REFERENCES users(id),
  opened_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS matter_field_history (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matters(id),
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Record types drive type-based layouts/fields (keys align with matters.matter_type)
CREATE TABLE IF NOT EXISTS record_types (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Custom fields: global, record-type-based, or record-based (single matter)
CREATE TABLE IF NOT EXISTS custom_fields (
  id INTEGER PRIMARY KEY,
  api_name TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL
    CHECK (field_type IN ('text','textarea','number','date','select','checkbox')),
  options_json TEXT,
  record_type_key TEXT REFERENCES record_types(key),
  matter_id INTEGER REFERENCES matters(id),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (matter_id IS NOT NULL AND record_type_key IS NULL)
    OR (matter_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_scope_name
  ON custom_fields(
    api_name,
    IFNULL(record_type_key, ''),
    IFNULL(matter_id, 0)
  );

CREATE TABLE IF NOT EXISTS custom_field_values (
  matter_id INTEGER NOT NULL REFERENCES matters(id),
  field_id INTEGER NOT NULL REFERENCES custom_fields(id),
  value_text TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (matter_id, field_id)
);

-- Page layouts: one per record type, optional per-matter override
CREATE TABLE IF NOT EXISTS page_layouts (
  id INTEGER PRIMARY KEY,
  record_type_key TEXT REFERENCES record_types(key),
  matter_id INTEGER REFERENCES matters(id),
  name TEXT NOT NULL DEFAULT 'Default',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (matter_id IS NOT NULL AND record_type_key IS NULL)
    OR (matter_id IS NULL AND record_type_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_layouts_type
  ON page_layouts(record_type_key) WHERE matter_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_layouts_matter
  ON page_layouts(matter_id) WHERE matter_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS page_layout_items (
  id INTEGER PRIMARY KEY,
  layout_id INTEGER NOT NULL REFERENCES page_layouts(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'details',
  sort_order INTEGER NOT NULL DEFAULT 0,
  width TEXT NOT NULL DEFAULT 'half' CHECK (width IN ('half','full'))
);

CREATE INDEX IF NOT EXISTS idx_page_layout_items_layout
  ON page_layout_items(layout_id, sort_order);

-- Matter-level OneDrive / SharePoint folder link (prototype; Graph OAuth deferred)
CREATE TABLE IF NOT EXISTS matter_onedrive (
  matter_id INTEGER PRIMARY KEY REFERENCES matters(id) ON DELETE CASCADE,
  folder_url TEXT NOT NULL,
  folder_name TEXT,
  drive_item_id TEXT,
  status TEXT NOT NULL DEFAULT 'linked'
    CHECK (status IN ('linked','error')),
  notes TEXT,
  linked_by INTEGER REFERENCES users(id),
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('matter','client','timekeeper')),
  scope_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_rates_lookup
  ON rates(scope, scope_id, effective_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  message TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matters(id),
  timekeeper_id INTEGER NOT NULL REFERENCES users(id),
  service_date TEXT NOT NULL,
  entered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  raw_minutes INTEGER NOT NULL CHECK (raw_minutes > 0),
  -- 0 allowed when nearest/down rounds below the interval (e.g. 14 min → 0 at 30-min nearest)
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

CREATE INDEX IF NOT EXISTS idx_time_entries_matter_date
  ON time_entries(matter_id, service_date, timekeeper_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matters(id),
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'prebill'
    CHECK (status IN ('prebill','in_review','approved','sent','void')),
  issue_date TEXT,
  due_date TEXT,
  sent_at TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  write_down_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  voided_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  time_entry_id INTEGER REFERENCES time_entries(id),
  service_date TEXT NOT NULL,
  description TEXT NOT NULL,
  timekeeper_id INTEGER NOT NULL REFERENCES users(id),
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  rate_cents INTEGER NOT NULL CHECK (rate_cents >= 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  write_down_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS write_downs (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  invoice_line_id INTEGER REFERENCES invoice_lines(id),
  delta_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  number TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  received_on TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payment_applications (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS number_counters (
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (name, year)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Append-only audit log
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- Sent invoices immutable
CREATE TRIGGER IF NOT EXISTS invoices_sent_immutable
BEFORE UPDATE ON invoices
WHEN OLD.status = 'sent' AND (
  NEW.subtotal_cents != OLD.subtotal_cents OR
  NEW.write_down_cents != OLD.write_down_cents OR
  NEW.total_cents != OLD.total_cents OR
  NEW.matter_id != OLD.matter_id OR
  NEW.number != OLD.number
)
BEGIN
  SELECT RAISE(ABORT, 'sent invoices are immutable; use credit notes');
END;

CREATE TRIGGER IF NOT EXISTS invoice_lines_sent_immutable
BEFORE UPDATE ON invoice_lines
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'lines on sent invoices are immutable');
END;

CREATE TRIGGER IF NOT EXISTS invoice_lines_sent_no_delete
BEFORE DELETE ON invoice_lines
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'lines on sent invoices cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS payments_no_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS invoices_no_delete
BEFORE DELETE ON invoices
BEGIN
  SELECT RAISE(ABORT, 'invoices cannot be deleted; void instead');
END;

CREATE TRIGGER IF NOT EXISTS time_entries_link_invoice
AFTER INSERT ON invoice_lines
WHEN NEW.time_entry_id IS NOT NULL
BEGIN
  UPDATE time_entries SET status = 'invoiced', invoice_id = NEW.invoice_id
  WHERE id = NEW.time_entry_id;
END;
