function pagePlugin(href) {
  const query = new URLSearchParams({
    href,
    tabs: "timeline",
    width: "500",
    height: "800",
    small_header: "true",
    adapt_container_width: "true",
    hide_cover: "true",
    show_facepile: "false",
  });
  return `https://www.facebook.com/plugins/page.php?${query}`;
}

export const FACEBOOK_PAGES = [
  {
    id: "village",
    name: "Village of Indiantown",
    kind: "Village government",
    href: "https://www.facebook.com/villageofindiantown/",
    site: "https://www.indiantownfl.gov/",
    blurb: "Official Village posts, alerts, and meeting notes.",
  },
  {
    id: "chamber",
    name: "Indiantown Chamber of Commerce",
    kind: "Chamber",
    href: "https://www.facebook.com/itownchamber/",
    site: "https://www.indiantownchamber.com/",
    blurb: "Local business events and civic updates from the Chamber.",
  },
  {
    id: "library",
    name: "Martin County Library System",
    kind: "Library",
    href: "https://www.facebook.com/MartinCountyLibrarySystem/",
    site: "https://www.martin.fl.us/elisabeth-lahti-library",
    blurb: "County library posts, including Elisabeth Lahti Library in Indiantown.",
  },
  {
    id: "county",
    name: "Martin County Commission",
    kind: "County government",
    href: "https://www.facebook.com/MartinCountyBoardofCountyCommissioners/",
    site: "https://www.martin.fl.us/",
    blurb: "County services, roads, MARTY transit, and public notices.",
  },
  {
    id: "sheriff",
    name: "Martin County Sheriff",
    kind: "Public safety",
    href: "https://www.facebook.com/p/Martin-County-Sheriffs-Office-100064720504280/",
    site: "https://www.mcsofl.org/",
    blurb: "Official Sheriff posts and public-safety alerts for Martin County.",
  },
];

export function listFacebookPages() {
  return FACEBOOK_PAGES.map((row) => ({ ...row, embed: pagePlugin(row.href) }));
}
