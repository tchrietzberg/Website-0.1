/**
 * Ensure at least 30 Open, Closed, and Possible matters, each with time entries.
 * Safe to re-run: only fills shortfalls.
 */
const { openDb, migrate, DEFAULT_DB } = require('../src/db');
const matterSvc = require('../src/services/matters');
const timeSvc = require('../src/services/time');
const customFields = require('../src/services/customFields');

const TARGET_PER_STATUS = 30;
const ENTRIES_PER_MATTER = 3;

const CLIENT_NAMES = [
  'Northwind Holdings LLC',
  'Acme Pension Fund',
  'Lakeside Credit Union',
  'Horizon Benefits Trust',
  'Cypress Municipal Partners',
];

const OPEN_NAMES = [
  'Harbor Bridge Securities Inquiry',
  'Westbrook Class Notice Review',
  'Pinecrest Merger Diligence',
  'Oakmont Derivative Demand',
  'Ridgeline Insider Trading File',
  'Silver Creek Proxy Contest',
  'Blue Heron Bond Default',
  'Maple Court Appraisal Action',
  'Stonegate Tender Offer',
  'Willow Park 10b-5 Claim',
  'Cedar Point Audit Committee',
  'Ironwood Going-Private Review',
  'Foxglove Warrant Dispute',
  'Larkspur Secondary Offering',
  'Redwood SPAC Wind-Down',
  'Cottonwood Preferred Stock',
  'Bayshore Short-Swing Recovery',
  'Elm Street Books and Records',
  'Summit Ridge Restatement',
  'Prairie Wind Fiduciary Duty',
  'North Pier Contested Solicitation',
  'Granite Falls 13D Response',
  'Sunset Harbor Indemnity Claim',
  'Copper Hill ESG Disclosure',
  'Riverbend Control Contest',
  'Ashford Trade Secret Parallel',
  'Midland Clearinghouse Dispute',
  'Seaglass Notes Indenture',
  'Brighton Fairness Opinion',
  'Kingsley Follow-On Diligence',
];

const CLOSED_NAMES = [
  'Amberfield Settlement Administration',
  'Brookside Opt-Out Resolution',
  'Clearwater Fee Application',
  'Dove Creek Judgment Collection',
  'Eastgate Dismissal With Prejudice',
  'Fairview Claims Administration',
  'Goldleaf Appeal Mandate',
  'Hillcrest Bar Order Entry',
  'Ivory Coast ADR Closeout',
  'Juniper Release Negotiation',
  'Keepsake Stipulated Dismissal',
  'Linden Final Approval',
  'Mossy Oak Contribution Bar',
  'Nightingale Costs Award',
  'Orchard Lane Satisfaction',
  'Pebble Beach Cy Pres',
  'Quarry Road Remittitur',
  'Rosewood Voluntary Dismissal',
  'Sandpiper Offer of Judgment',
  'Thistle Court Consent Decree',
  'Umber Creek Walk-Away',
  'Violet Hill Mutual Release',
  'Wrenwood Tax Allocation',
  'Yarrow Street Nonsuit',
  'Zephyr Cove Enforcement End',
  'Aspen Court Mandate Spread',
  'Bristol Dockets Archived',
  'Cinder Lane Fee Split',
  'Driftwood Closing Binder',
  'Evergreen Post-Judgment',
];

const POSSIBLE_NAMES = [
  'Avalon Whistleblower Intake',
  'Briar Patch Confidential Inquiry',
  'Canyon Rim Pre-Suit Demand',
  'Dunhill Informal Investigation',
  'Echo Lake Board Interview',
  'Fernwood Document Hold Watch',
  'Glacier Peak Lead Plaintiff Screen',
  'Hawthorn Conflict Check',
  'Indigo Run Referral Review',
  'Jade Harbor Statute Screen',
  'Kestrel Point Preservation Letter',
  'Lumen Field Early Case Eval',
  'Marigold Confidential Source',
  'Nestled Oak Privilege Screen',
  'Osprey Cove Damages Sketch',
  'Palisades Pre-Filing Memo',
  'Quince Street Witness Canvas',
  'Raven Ridge Insurance Notice',
  'Sagebrush Venue Analysis',
  'Tidal Basin Tolling Talks',
  'Umber Pre-Complaint Draft',
  'Vesper Potential Class Size',
  'Wisteria Expert Screen',
  'Yew Court Standing Check',
  'Zinnia Related-Case Scan',
  'Alder Confidential Demand',
  'Boxwood Informal Discovery',
  'Crocus Preservation Hold',
  'Dahlia Conflict Waiver',
  'Edelweiss Case Theory Memo',
];

const TIME_DESCRIPTIONS = [
  'Review client correspondence and docket entries',
  'Telephone conference with client regarding case strategy',
  'Draft and revise motion outline',
  'Analyze opposing counsel production',
  'Prepare for meet and confer',
  'Research controlling circuit authority',
  'Revise engagement correspondence',
  'Attend internal case-status conference',
  'Outline deposition topics',
  'Review and code key documents',
];

const HOURS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

function padDate(n) {
  return String(n).padStart(2, '0');
}

function serviceDateFor(index, offset) {
  const month = 1 + ((index + offset) % 12);
  const day = 1 + ((index * 3 + offset * 2) % 27);
  const year = 2025 + ((index + offset) % 2);
  return `${year}-${padDate(month)}-${padDate(day)}`;
}

function ensureClients(db) {
  const insert = db.prepare('INSERT INTO clients(name) VALUES (?)');
  for (const name of CLIENT_NAMES) {
    const row = db.prepare('SELECT id FROM clients WHERE name = ?').get(name);
    if (!row) insert.run(name);
  }
  return db.prepare('SELECT id FROM clients ORDER BY id').all().map((r) => r.id);
}

function ensureActor(db) {
  let actor = db.prepare("SELECT * FROM users WHERE email = 'avery@firm.example'").get();
  if (!actor) {
    actor = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  }
  if (!actor) throw new Error('seed demo matters: no admin user');
  return actor;
}

function attorneys(db) {
  const rows = db.prepare(
    "SELECT id FROM users WHERE role IN ('admin','attorney') ORDER BY id"
  ).all();
  return rows.length ? rows.map((r) => r.id) : [ensureActor(db).id];
}

function seedDemoMatters(db, options = {}) {
  const target = Number(options.targetPerStatus || TARGET_PER_STATUS);
  const entriesPerMatter = Number(options.entriesPerMatter || ENTRIES_PER_MATTER);
  customFields.ensureRecordTypes(db);
  customFields.ensureTypeLayout(db, customFields.DEFAULT_RECORD_TYPE_KEY);
  const actor = ensureActor(db);
  matterSvc.ensureStandardMatterNameFormula(db, actor);
  const caseTypeField = matterSvc.ensureCaseTypeField(db, actor);
  const clientIds = ensureClients(db);
  const attorneyIds = attorneys(db);
  const caseTypes = matterSvc.CASE_TYPE_OPTIONS;
  const namesByStatus = {
    open: OPEN_NAMES,
    closed: CLOSED_NAMES,
    possible: POSSIBLE_NAMES,
  };

  const created = { open: 0, closed: 0, possible: 0, timeEntries: 0 };

  for (const status of matterSvc.MATTER_STATUSES) {
    const have = db.prepare('SELECT COUNT(*) AS n FROM matters WHERE status = ?').get(status).n;
    const need = Math.max(0, target - have);
    const names = namesByStatus[status] || [];
    for (let i = 0; i < need; i += 1) {
      const base = names[i] || `${status} matter ${String(i + 1).padStart(2, '0')}`;
      const openedOn = serviceDateFor(i, 0);
      const page = matterSvc.createMatter(db, actor, {
        name: base,
        status,
        clientId: clientIds[i % clientIds.length],
        responsibleAttorneyId: attorneyIds[i % attorneyIds.length],
        openedOn,
        jurisdiction: i % 2 === 0 ? 'S.D. Fla.' : 'N.D. Cal.',
        court: i % 2 === 0 ? 'S.D. Fla.' : 'N.D. Cal.',
        customValues: {
          [caseTypeField.id]: caseTypes[(i + (status === 'closed' ? 2 : status === 'possible' ? 4 : 0)) % caseTypes.length],
        },
      });
      const matterId = page.matter.id;
      for (let e = 0; e < entriesPerMatter; e += 1) {
        timeSvc.createEntry(db, actor, {
          matterId,
          timekeeperId: attorneyIds[(i + e) % attorneyIds.length],
          serviceDate: serviceDateFor(i, e + 1),
          hours: HOURS[(i + e) % HOURS.length],
          description: TIME_DESCRIPTIONS[(i + e) % TIME_DESCRIPTIONS.length],
          billable: status === 'possible' && e === 0 ? 0 : 1,
        });
        created.timeEntries += 1;
      }
      created[status] += 1;
    }
  }

  const renamed = matterSvc.applyMatterNomenclature(db, actor);
  return { ...created, renamed };
}

function counts(db) {
  const byStatus = {};
  for (const status of matterSvc.MATTER_STATUSES) {
    byStatus[status] = db.prepare('SELECT COUNT(*) AS n FROM matters WHERE status = ?').get(status).n;
  }
  const timeEntries = db.prepare('SELECT COUNT(*) AS n FROM time_entries').get().n;
  const mattersWithTime = db.prepare(`
    SELECT COUNT(DISTINCT matter_id) AS n FROM time_entries
  `).get().n;
  return { ...byStatus, timeEntries, mattersWithTime };
}

if (require.main === module) {
  const dbFile = process.env.DB_FILE || DEFAULT_DB;
  const db = openDb(dbFile);
  migrate(db);
  const before = counts(db);
  const created = seedDemoMatters(db);
  const after = counts(db);
  console.log(`Demo matters seeded ${dbFile}`);
  console.log('created', created);
  console.log('before', before);
  console.log('after', after);
}

module.exports = {
  TARGET_PER_STATUS,
  seedDemoMatters,
  counts,
};
