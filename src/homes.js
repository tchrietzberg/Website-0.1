export const ZILLOW_LINKS = {
  sale: "https://www.zillow.com/indiantown-fl/",
  newest:
    "https://www.zillow.com/indiantown-fl/?searchQueryState=%7B%22filterState%22%3A%7B%22sort%22%3A%7B%22value%22%3A%22days%22%7D%7D%7D",
  rent: "https://www.zillow.com/indiantown-fl/rentals/",
  sold: "https://www.zillow.com/indiantown-fl/sold/",
  newHomes: "https://www.zillow.com/indiantown-fl/new-homes/",
  zip: "https://www.zillow.com/homes/34956_rb/",
};

function zillowSearch(address) {
  return `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;
}

export const ZILLOW_RECENT = [
  {
    address: "134 SW Seminole Crossing Ct SW",
    city: "Indiantown, FL 34956",
    price: 355000,
    beds: 4,
    baths: 2,
    sqft: 1397,
    kind: "New construction",
    url: "https://www.zillow.com/homedetails/134-SW-Seminole-Crossing-Ct-SW-Indiantown-FL-34956/462604650_zpid/",
  },
  {
    address: "13784 SW Reed Rd",
    city: "Indiantown, FL 34956",
    price: 356590,
    beds: 4,
    baths: 2,
    sqft: 1607,
    kind: "New construction",
    url: "https://www.zillow.com/homedetails/13784-SW-Reed-Rd-Indiantown-FL-34956/463080100_zpid/",
  },
  {
    address: "14417 SW New Dawn Rd",
    city: "Indiantown, FL 34956",
    price: 419990,
    beds: 4,
    baths: 2,
    sqft: 1840,
    kind: "For sale",
    url: zillowSearch("14417 SW New Dawn Rd, Indiantown, FL 34956"),
  },
  {
    address: "15975 SW Vine Dr",
    city: "Indiantown, FL 34956",
    price: 415000,
    beds: 4,
    baths: 2,
    sqft: 1840,
    kind: "For sale",
    url: zillowSearch("15975 SW Vine Dr, Indiantown, FL 34956"),
  },
  {
    address: "14516 SW New Dawn Rd",
    city: "Indiantown, FL 34956",
    price: null,
    beds: 4,
    baths: 3,
    sqft: 2168,
    kind: "New construction",
    url: zillowSearch("14516 SW New Dawn Rd, Indiantown, FL 34956"),
  },
  {
    address: "13671 SW Vine Dr",
    city: "Indiantown, FL 34956",
    price: 356590,
    beds: 4,
    baths: 2,
    sqft: 1607,
    kind: "New construction",
    url: zillowSearch("13671 SW Vine Dr, Indiantown, FL 34956"),
  },
];

export function listZillowHomes() {
  return { links: ZILLOW_LINKS, recent: ZILLOW_RECENT };
}
