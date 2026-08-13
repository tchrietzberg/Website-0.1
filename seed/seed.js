import { isEmpty, openDb } from "../src/db.js";

const businesses = [
  {
    name: "Osceola Feed & Hardware",
    category: "retail",
    description:
      "Feed, fence, irrigation parts, and Saturday morning coffee on the porch. Serves groves and backyards from Booker Park to SR 710.",
    owner_name: "Marisol Vega",
    phone: "(772) 555-0142",
    email: "hello@osceolafeed.example",
    website: "",
    address: "14720 SW Warfield Blvd, Indiantown, FL 34956",
  },
  {
    name: "Warfield Family Kitchen",
    category: "food",
    description:
      "Breakfast plates, cafecito, and Friday fish. Indoor seating and a takeout window facing the lot.",
    owner_name: "Elena Ruiz",
    phone: "(772) 555-0188",
    email: "orders@warfieldkitchen.example",
    website: "",
    address: "15540 SW Osceola St, Indiantown, FL 34956",
  },
  {
    name: "Citrus Grove Auto",
    category: "auto",
    description:
      "Brakes, A/C, and inspections for trucks and daily drivers. Loaner bikes if you live in town.",
    owner_name: "James Whitaker",
    phone: "(772) 555-0119",
    email: "shop@citrusgroveauto.example",
    website: "",
    address: "16210 SW Farm Rd, Indiantown, FL 34956",
  },
  {
    name: "Booker Park Landscaping",
    category: "trades",
    description:
      "Mowing, sod, and drainage work. Crews available midweek and after storms.",
    owner_name: "Andre Jackson",
    phone: "(772) 555-0160",
    email: "crew@bookerparkland.example",
    website: "",
    address: "15101 SW 169th Ave area, Indiantown, FL 34956",
  },
  {
    name: "Canal Side Child Care",
    category: "care",
    description:
      "Licensed daycare with bilingual staff. Open 6:30 a.m. to 6 p.m. on weekdays.",
    owner_name: "Rosa Delgado",
    phone: "(772) 555-0174",
    email: "office@canalsidekids.example",
    website: "",
    address: "14880 SW Thelma Waters Ave, Indiantown, FL 34956",
  },
  {
    name: "Blue Heron Produce Stand",
    category: "farm",
    description:
      "Seasonal citrus, peppers, and eggs. Cash or Venmo. Closes when the crates are empty.",
    owner_name: "Tomás Herrera",
    phone: "(772) 555-0133",
    email: "stand@blueheronproduce.example",
    website: "",
    address: "Pull-off on SW Warfield Blvd, Indiantown, FL 34956",
  },
];

const listings = [
  {
    title: "Riding mower, runs, needs belt",
    category: "for-sale",
    description:
      "Craftsman 42-inch. Starts cold. Belt slips on wet grass. Parked under a carport near Booker Park. Cash or local trade.",
    price_cents: 45000,
    contact_name: "Luis Ortega",
    phone: "(772) 555-0201",
    email: "luis.ortega@example.com",
    neighborhood: "Booker Park",
  },
  {
    title: "Looking for weekend grove help",
    category: "jobs",
    description:
      "Need two people Saturday mornings through May for picking and crate stacking. Pay in cash at end of day. Must have own ride to the west side of 710.",
    price_cents: null,
    contact_name: "Patricia Nguyen",
    phone: "(772) 555-0208",
    email: "pnguyen@example.com",
    neighborhood: "West of 710",
  },
  {
    title: "Room for rent near Warfield",
    category: "housing",
    description:
      "Furnished bedroom, shared kitchen, quiet house. Utilities included. Prefer someone who works days. First month plus deposit.",
    price_cents: 75000,
    contact_name: "Diane Cole",
    phone: "(772) 555-0215",
    email: "diane.cole@example.com",
    neighborhood: "Warfield",
  },
  {
    title: "Wanted: used window A/C",
    category: "wanted",
    description:
      "Looking for a working 8,000–10,000 BTU unit for a small apartment off Osceola. Can pick up this week.",
    price_cents: 8000,
    contact_name: "Miguel Santos",
    phone: "(772) 555-0222",
    email: "msantos@example.com",
    neighborhood: "Osceola Street",
  },
  {
    title: "Mobile notary after 5 p.m.",
    category: "services",
    description:
      "I come to you in Indiantown and Palm City. Real estate, school forms, and titles. Text first — I do not answer unknown numbers while driving.",
    price_cents: 3500,
    contact_name: "Keisha Grant",
    phone: "(772) 555-0230",
    email: "keisha.notary@example.com",
    neighborhood: "All of 34956",
  },
  {
    title: "Saturday rummage at the fellowship hall",
    category: "community",
    description:
      "Clothes, toys, and kitchen goods. 8 a.m. to noon. Tables are free for neighbors who want to sell. Bring your own shade.",
    price_cents: null,
    contact_name: "Hope Fellowship Volunteers",
    phone: "(772) 555-0236",
    email: "events@hopefellowship.example",
    neighborhood: "Downtown",
  },
];

const news = [
  {
    title: "Village Council meets Tuesday at Village Hall",
    body: "The next regular meeting is Tuesday at 6:30 p.m. at 15516 SW Osceola St., Suite B. Agenda packets are posted on the Village site. Public comment is at the start of the meeting.",
    author: "Indiantown Board",
  },
  {
    title: "Utility billing reminder for water and sewer",
    body: "Pay online at the Village municipal payments portal or call 772-597-2121. Keep the phone and email on your account current so shutoff notices reach you.",
    author: "Indiantown Board",
  },
  {
    title: "Youth baseball sign-up at Booker Park",
    body: "Registration tables will be at Booker Park this Saturday morning. Bring a birth certificate and a proof of address. Volunteers needed for concession.",
    author: "Parks neighbors",
  },
];

const resources = [
  {
    title: "Village of Indiantown",
    category: "government",
    description: "Official village site: council, permits, parks, and department contacts.",
    url: "https://www.indiantownfl.gov/",
    phone: "(772) 597-9900",
    address: "15516 SW Osceola St., Suite B, Indiantown, FL 34956",
  },
  {
    title: "Water and wastewater billing",
    category: "utilities",
    description: "Pay a water or sewer bill, view balance, or update the contact on your account.",
    url: "https://indiantownfl.municipalonlinepayments.com/indiantownfl/utilities",
    phone: "(772) 597-2121",
    address: "Village of Indiantown Utilities",
  },
  {
    title: "Martin County",
    category: "government",
    description: "County services, emergency notices, and property information.",
    url: "https://www.martin.fl.us/",
    phone: "(772) 288-5400",
    address: "Martin County, Florida",
  },
  {
    title: "Warfield Elementary School",
    category: "schools",
    description: "Martin County School District elementary campus in Indiantown.",
    url: "https://www.martinschools.org/",
    phone: "",
    address: "15260 SW 150th St, Indiantown, FL 34956",
  },
  {
    title: "Elisabeth Lahti Library",
    category: "schools",
    description: "Public library serving Indiantown residents.",
    url: "https://www.martin.fl.us/",
    phone: "",
    address: "SW Thelma Waters Ave, Indiantown, FL 34956",
  },
  {
    title: "Florida 211",
    category: "help",
    description: "Free, confidential help finding food, housing, and local assistance.",
    url: "https://www.211.org/",
    phone: "211",
    address: "",
  },
  {
    title: "Emergency",
    category: "help",
    description: "Police, fire, and medical emergency. For non-emergency sheriff, use the county line.",
    url: "",
    phone: "911",
    address: "",
  },
  {
    title: "Booker Park",
    category: "parks",
    description: "Neighborhood park used for sports, sign-ups, and weekend gatherings.",
    url: "https://www.indiantownfl.gov/",
    phone: "(772) 597-9900",
    address: "15101 SW 169th Ave, Indiantown, FL 34956",
  },
];

const rooms = [
  {
    title: "Saturday at Booker Park",
    topic: "events",
    description: "Who is bringing water, shade, and extra gloves for the park cleanup?",
    host_name: "Parks neighbors",
    host_email: "parks@example.com",
    status: "approved",
  },
  {
    title: "Jobs and rides this week",
    topic: "jobs",
    description: "Share grove, shop, and ride-share needs for people already in 34956.",
    host_name: "Patricia Nguyen",
    host_email: "pnguyen@example.com",
    status: "approved",
  },
  {
    title: "Spanish homework hour",
    topic: "youth",
    description: "Pending room for after-school help. Waiting on admin review.",
    host_name: "Rosa Delgado",
    host_email: "rosa@example.com",
    status: "pending",
  },
];

const roomMessages = [
  { room: "Saturday at Booker Park", author: "Andre", body: "I can bring two extra rakes and be there at 8." },
  { room: "Saturday at Booker Park", author: "Elena", body: "Cafecito for volunteers after we finish the north field." },
  { room: "Jobs and rides this week", author: "Luis", body: "Need a ride to the west side of 710 Saturday morning." },
];

export function seedRooms(db, { force = false } = {}) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM rooms").get().n;
  if (!force && n > 0) return { seeded: false };
  const insertRoom = db.prepare(
    `INSERT INTO rooms (title, topic, description, host_name, host_email, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertMsg = db.prepare("INSERT INTO messages (room_id, author, body) VALUES (?, ?, ?)");
  for (const row of rooms) {
    const result = insertRoom.run(
      row.title,
      row.topic,
      row.description,
      row.host_name,
      row.host_email,
      row.status,
    );
    for (const msg of roomMessages.filter((m) => m.room === row.title)) {
      insertMsg.run(result.lastInsertRowid, msg.author, msg.body);
    }
  }
  return { seeded: true };
}

export function seed(db, { force = false } = {}) {
  if (!force && !isEmpty(db)) {
    seedRooms(db);
    return { seeded: false };
  }
  const insertBiz = db.prepare(
    `INSERT INTO businesses
      (name, category, description, owner_name, phone, email, website, address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertListing = db.prepare(
    `INSERT INTO listings
      (title, category, description, price_cents, contact_name, phone, email, neighborhood)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertNews = db.prepare("INSERT INTO news (title, body, author) VALUES (?, ?, ?)");
  const insertRes = db.prepare(
    `INSERT INTO resources (title, category, description, url, phone, address)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  db.exec("BEGIN");
  try {
    for (const row of businesses) {
      insertBiz.run(
        row.name,
        row.category,
        row.description,
        row.owner_name,
        row.phone,
        row.email,
        row.website,
        row.address,
      );
    }
    for (const row of listings) {
      insertListing.run(
        row.title,
        row.category,
        row.description,
        row.price_cents,
        row.contact_name,
        row.phone,
        row.email,
        row.neighborhood,
      );
    }
    for (const row of news) insertNews.run(row.title, row.body, row.author);
    for (const row of resources) {
      insertRes.run(row.title, row.category, row.description, row.url, row.phone, row.address);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  seedRooms(db, { force: true });
  return { seeded: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  const result = seed(db, { force: process.argv.includes("--force") });
  console.log(result.seeded ? "Seeded Indiantown Board." : "Database already has data; skipped.");
}
