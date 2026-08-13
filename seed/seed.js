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
    title: "911 Emergency",
    category: "safety",
    description: "Police, fire, and medical emergency. Use this number only when someone is in danger.",
    url: "",
    phone: "911",
    address: "",
  },
  {
    title: "Police (Martin County Sheriff)",
    category: "safety",
    description: "Non-emergency dispatch for Indiantown. The Village does not have its own police department.",
    url: "https://www.mcsofl.org/",
    phone: "(772) 220-7170",
    address: "Martin County Sheriff's Office",
  },
  {
    title: "Sheriff — Indiantown district",
    category: "safety",
    description: "Indiantown and agricultural crimes unit. For an emergency, call 911 first.",
    url: "https://www.mcsofl.org/",
    phone: "(772) 220-7190",
    address: "16550 SW Warfield Blvd, Indiantown, FL 34956",
  },
  {
    title: "Fire Rescue Station 24",
    category: "safety",
    description: "Martin County Fire Rescue station serving Indiantown. Fire, rescue, and ambulance. Call 911 in an emergency.",
    url: "https://www.martin.fl.us/FireRescue",
    phone: "(772) 597-2598",
    address: "16550 SW Warfield Blvd, Indiantown, FL 34956",
  },
  {
    title: "Poison Control",
    category: "safety",
    description: "24-hour poison help for people and pets.",
    url: "https://www.poison.org/",
    phone: "1-800-222-1222",
    address: "",
  },
  {
    title: "Village of Indiantown",
    category: "government",
    description: "Village Hall: permits, parks, utilities, and department contacts. Monday–Friday 8 a.m.–5 p.m.",
    url: "https://www.indiantownfl.gov/",
    phone: "(772) 597-9900",
    address: "15516 SW Osceola St., Suite B, Indiantown, FL 34956",
  },
  {
    title: "Village Council",
    category: "government",
    description: "Mayor and council. Regular meetings are the 2nd and 4th Thursdays at 6 p.m. in Council Chambers.",
    url: "https://www.indiantownfl.gov/village-clerk/page/village-council",
    phone: "(772) 597-9900",
    address: "15516 SW Osceola St., Suite B, Indiantown, FL 34956",
  },
  {
    title: "Village Clerk",
    category: "government",
    description: "Agendas, minutes, public records, and council support.",
    url: "https://www.indiantownfl.gov/directory",
    phone: "(772) 597-8294",
    address: "15516 SW Osceola St., Suite B, Indiantown, FL 34956",
  },
  {
    title: "Building and permits",
    category: "government",
    description: "Building, zoning, and driveway permits through Civic Access. Office hours Monday–Friday 8 a.m.–4 p.m.",
    url: "https://www.indiantownfl.gov/building/page/building-permits",
    phone: "(772) 597-8281",
    address: "15516 SW Osceola St., Suite B, Indiantown, FL 34956",
  },
  {
    title: "Code compliance",
    category: "government",
    description: "Report overgrowth, junk, or other village code issues.",
    url: "https://www.indiantownfl.gov/contact-us",
    phone: "(772) 597-0085",
    address: "Village of Indiantown",
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
    title: "Alert Martin",
    category: "government",
    description: "Sign up for county emergency alerts by phone, text, or email.",
    url: "https://www.martin.fl.us/AlertMartin",
    phone: "(772) 287-1652",
    address: "Martin County Emergency Management",
  },
  {
    title: "Water and wastewater billing",
    category: "utilities",
    description: "Pay a Village water or sewer bill, view a balance, or update the contact on your account.",
    url: "https://indiantownfl.municipalonlinepayments.com/indiantownfl/utilities",
    phone: "(772) 597-2121",
    address: "Village of Indiantown Utilities",
  },
  {
    title: "Public works",
    category: "utilities",
    description: "Streets, drainage, and Village utility field work.",
    url: "https://www.indiantownfl.gov/contact-us",
    phone: "(772) 597-2201",
    address: "Village of Indiantown Public Works",
  },
  {
    title: "Garbage and recycling",
    category: "utilities",
    description: "Village pickup is through Waste Management: garbage Tue/Fri, recycling Tue, yard waste Wed. Call for missed pickup or bulk items.",
    url: "https://www.martin.fl.us/Garbage-Recycling-Yard-Waste",
    phone: "(772) 546-7700",
    address: "Waste Management — Martin County",
  },
  {
    title: "FPL power",
    category: "utilities",
    description: "Report a power outage or downed line. Call 911 if a line is on a person or blocking a road with immediate danger.",
    url: "https://www.fpl.com/",
    phone: "1-800-468-8243",
    address: "Florida Power & Light",
  },
  {
    title: "Warfield Elementary School",
    category: "schools",
    description: "Martin County School District elementary campus in Indiantown.",
    url: "https://www.martinschools.org/",
    phone: "(772) 597-2551",
    address: "15260 SW 150th St, Indiantown, FL 34956",
  },
  {
    title: "Indiantown Middle School",
    category: "schools",
    description: "Martin County School District middle school on Farm Road.",
    url: "https://www.martinschools.org/",
    phone: "(772) 597-2146",
    address: "16303 SW Farm Rd, Indiantown, FL 34956",
  },
  {
    title: "Martin County School District",
    category: "schools",
    description: "Enrollment, calendars, buses, and district offices.",
    url: "https://www.martinschools.org/",
    phone: "(772) 219-1200",
    address: "1939 SE Federal Hwy, Stuart, FL 34994",
  },
  {
    title: "Elisabeth Lahti Library",
    category: "schools",
    description: "Public library for Indiantown. Tue 12–8; Wed–Sat 10–5:30. Closed Sunday and Monday.",
    url: "https://www.martin.fl.us/elisabeth-lahti-library",
    phone: "(772) 597-4200",
    address: "15200 E. Thelma Waters Ave, Indiantown, FL 34956",
  },
  {
    title: "Florida Community Health Centers",
    category: "health",
    description: "Indiantown clinic: primary care, pediatrics, dental, and women's health. Sliding-fee program available.",
    url: "https://www.fchcinc.org/locations/indiantown/",
    phone: "(772) 237-8580",
    address: "15858 SW Warfield Blvd, Indiantown, FL 34956",
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
    title: "Domestic violence help",
    category: "help",
    description: "Florida Domestic Violence Hotline. 24 hours. Call 911 if you are in immediate danger.",
    url: "https://www.fcadv.org/",
    phone: "1-800-500-1119",
    address: "",
  },
  {
    title: "Animal Services",
    category: "help",
    description: "Martin County Animal Services for stray, injured, or dangerous animals. Call 911 if a person is being attacked.",
    url: "https://www.mcsofl.org/",
    phone: "(772) 463-3211",
    address: "Martin County Sheriff's Office",
  },
  {
    title: "Indiantown Post Office",
    category: "help",
    description: "USPS window, PO boxes, and passport appointments.",
    url: "https://tools.usps.com/find-location.htm",
    phone: "(772) 597-2406",
    address: "15300 SW Adams Ave, Indiantown, FL 34956",
  },
  {
    title: "Parks and Recreation",
    category: "parks",
    description: "Village parks, fields, and recreation programs.",
    url: "https://www.indiantownfl.gov/contact-us",
    phone: "(772) 597-0084",
    address: "Village of Indiantown Parks & Recreation",
  },
  {
    title: "Booker Park",
    category: "parks",
    description: "Neighborhood park used for sports, sign-ups, and weekend gatherings.",
    url: "https://www.indiantownfl.gov/",
    phone: "(772) 597-0084",
    address: "15101 SW 169th Ave, Indiantown, FL 34956",
  },
];

export function ensureResources(db) {
  const find = db.prepare("SELECT id FROM resources WHERE title = ?");
  const insert = db.prepare(
    `INSERT INTO resources (title, category, description, url, phone, address)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE resources SET category = ?, description = ?, url = ?, phone = ?, address = ?
     WHERE title = ?`,
  );
  for (const title of ["Emergency"]) {
    db.prepare("DELETE FROM resources WHERE title = ?").run(title);
  }
  for (const row of resources) {
    if (find.get(row.title)) {
      update.run(row.category, row.description, row.url, row.phone, row.address, row.title);
    } else {
      insert.run(row.title, row.category, row.description, row.url, row.phone, row.address);
    }
  }
  return { count: db.prepare("SELECT COUNT(*) AS n FROM resources").get().n };
}

export function clearChatRooms(db) {
  db.exec("DELETE FROM messages");
  db.exec("DELETE FROM rooms");
  return { cleared: true };
}

export function seed(db, { force = false } = {}) {
  if (!force && !isEmpty(db)) {
    ensureResources(db);
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
  return { seeded: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  const result = seed(db, { force: process.argv.includes("--force") });
  const help = ensureResources(db);
  if (process.argv.includes("--reset-chat")) clearChatRooms(db);
  const rooms = db.prepare("SELECT COUNT(*) AS n FROM rooms").get().n;
  console.log(result.seeded ? "Seeded Indiantown Board." : "Updated existing Indiantown Board data.");
  console.log(`Help contacts: ${help.count}`);
  console.log(`Chat rooms: ${rooms}`);
}
