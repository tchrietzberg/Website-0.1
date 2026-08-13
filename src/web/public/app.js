const copy = {
  en: {
    brand: "Indiantown Board",
    navHome: "Home",
    navBoard: "Board",
    navDirectory: "Directory",
    navNews: "News",
    navResources: "Resources",
    navAbout: "About town",
    post: "Post",
    tabListing: "Listing",
    tabBusiness: "Business",
    tabNews: "News",
    footer:
      "Indiantown Board is a community bulletin for 34956. It is a standalone site and is not part of any other app.",
    heroKicker: "Village of Indiantown · Treasure Coast",
    heroTitle: "The local board for 34956.",
    heroLede:
      "Buy, sell, hire, list a company, and share news — only for people in and around Indiantown. English and Spanish welcome.",
    listings: "Listings",
    businesses: "Businesses",
    news: "News notes",
    resources: "Resources",
    latestBoard: "Latest on the board",
    latestNews: "Town notes",
    seeBoard: "See the full board",
    seeNews: "All news",
    addCompany: "Add your company",
    all: "All",
    listingCats: {
      "for-sale": "For sale",
      wanted: "Wanted",
      jobs: "Jobs",
      housing: "Housing",
      services: "Services",
      community: "Community",
    },
    bizCats: {
      food: "Food",
      trades: "Trades",
      auto: "Auto",
      health: "Health",
      retail: "Retail",
      farm: "Farm",
      care: "Care",
      other: "Other",
    },
    resCats: {
      government: "Government",
      utilities: "Utilities",
      schools: "Schools & library",
      health: "Health",
      help: "Help",
      parks: "Parks",
    },
    aboutTitle: "About Indiantown",
    aboutBody: [
      "Indiantown is a rural village in Martin County on Florida’s Treasure Coast. It was incorporated on December 31, 2017 — one of the state’s youngest municipalities — and is home to about 6,000 people.",
      "Village Hall is at 15516 SW Osceola St., Suite B. The Village runs water and wastewater service for town and nearby Martin County customers. This board is independent of Village government. Official business still lives on indiantownfl.gov.",
      "Use the board like a local Craigslist: post a listing, add a company with contact information, share a news note, or open the resource list for utilities, schools, and help lines.",
    ],
    form: {
      title: "Title",
      category: "Category",
      description: "Description",
      price: "Price (optional)",
      contact: "Your name",
      phone: "Phone",
      email: "Email",
      neighborhood: "Neighborhood or area",
      name: "Company name",
      owner: "Owner or contact",
      website: "Website (optional)",
      address: "Street address",
      author: "Your name",
      body: "Note",
      submitListing: "Post listing",
      submitBusiness: "Add company",
      submitNews: "Share note",
    },
    posted: "Posted. It is on the board now.",
    needFix: "Check the highlighted fields.",
    back: "Back",
    call: "Call",
    email: "Email",
    website: "Website",
    free: "No price listed",
  },
  es: {
    brand: "Tablón de Indiantown",
    navHome: "Inicio",
    navBoard: "Tablón",
    navDirectory: "Directorio",
    navNews: "Noticias",
    navResources: "Recursos",
    navAbout: "El pueblo",
    post: "Publicar",
    tabListing: "Anuncio",
    tabBusiness: "Negocio",
    tabNews: "Noticia",
    footer:
      "El Tablón de Indiantown es un boletín comunitario para el 34956. Es un sitio independiente y no forma parte de ninguna otra aplicación.",
    heroKicker: "Villa de Indiantown · Treasure Coast",
    heroTitle: "El tablón local del 34956.",
    heroLede:
      "Compre, venda, contrate, registre su empresa y comparta noticias — solo para gente de Indiantown y alrededores. Se habla español e inglés.",
    listings: "Anuncios",
    businesses: "Negocios",
    news: "Notas",
    resources: "Recursos",
    latestBoard: "Lo último en el tablón",
    latestNews: "Notas del pueblo",
    seeBoard: "Ver todo el tablón",
    seeNews: "Todas las noticias",
    addCompany: "Agregar su empresa",
    all: "Todo",
    listingCats: {
      "for-sale": "Se vende",
      wanted: "Se busca",
      jobs: "Empleos",
      housing: "Vivienda",
      services: "Servicios",
      community: "Comunidad",
    },
    bizCats: {
      food: "Comida",
      trades: "Oficios",
      auto: "Autos",
      health: "Salud",
      retail: "Comercio",
      farm: "Campo",
      care: "Cuidado",
      other: "Otro",
    },
    resCats: {
      government: "Gobierno",
      utilities: "Servicios públicos",
      schools: "Escuelas y biblioteca",
      health: "Salud",
      help: "Ayuda",
      parks: "Parques",
    },
    aboutTitle: "Sobre Indiantown",
    aboutBody: [
      "Indiantown es un pueblo rural en el condado de Martin, en la Treasure Coast de la Florida. Se incorporó el 31 de diciembre de 2017 — uno de los municipios más jóvenes del estado — y tiene unos 6,000 residentes.",
      "La alcaldía está en 15516 SW Osceola St., Suite B. El pueblo opera agua y alcantarillado. Este tablón es independiente del gobierno municipal. Los trámites oficiales siguen en indiantownfl.gov.",
      "Úselo como un Craigslist local: publique un anuncio, agregue su empresa con datos de contacto, comparta una nota o abra la lista de recursos.",
    ],
    form: {
      title: "Título",
      category: "Categoría",
      description: "Descripción",
      price: "Precio (opcional)",
      contact: "Su nombre",
      phone: "Teléfono",
      email: "Correo",
      neighborhood: "Barrio o zona",
      name: "Nombre de la empresa",
      owner: "Dueño o contacto",
      website: "Sitio web (opcional)",
      address: "Dirección",
      author: "Su nombre",
      body: "Nota",
      submitListing: "Publicar anuncio",
      submitBusiness: "Agregar empresa",
      submitNews: "Compartir nota",
    },
    posted: "Publicado. Ya está en el tablón.",
    needFix: "Revise los campos.",
    back: "Volver",
    call: "Llamar",
    email: "Correo",
    website: "Sitio",
    free: "Sin precio",
  },
};

const state = {
  lang: localStorage.getItem("it-lang") || "en",
  sheetTab: "listing",
  listingCategory: "",
  businessCategory: "",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = () => copy[state.lang];

function applyChrome() {
  document.documentElement.lang = state.lang;
  $$("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (t()[key]) el.textContent = t()[key];
  });
  $("[data-lang-toggle]").textContent = state.lang === "en" ? "ES" : "EN";
  const hash = location.hash.slice(2) || "";
  $$(".nav a").forEach((a) => {
    const href = a.getAttribute("href").slice(2);
    a.classList.toggle("is-on", href === hash || (href === "" && hash === ""));
  });
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

function money(cents) {
  if (cents == null) return t().free;
  return new Intl.NumberFormat(state.lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function options(map, selected = "") {
  return Object.entries(map)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function chips(map, current, on) {
  const all = `<button type="button" class="chip ${current ? "" : "is-on"}" data-chip="">${t().all}</button>`;
  const rest = Object.entries(map)
    .map(
      ([value, label]) =>
        `<button type="button" class="chip ${current === value ? "is-on" : ""}" data-chip="${value}">${label}</button>`,
    )
    .join("");
  return `<div class="toolbar" data-chips="${on}">${all}${rest}</div>`;
}

function listingCard(row) {
  return `<button class="card" data-open="listing" data-id="${row.id}">
    <span class="tag">${t().listingCats[row.category] || row.category}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <span class="price">${money(row.price_cents)}</span>
    <span class="muted">${escapeHtml(row.neighborhood)}</span>
  </button>`;
}

function businessCard(row) {
  return `<button class="card" data-open="business" data-id="${row.id}">
    <span class="tag">${t().bizCats[row.category] || row.category}</span>
    <strong>${escapeHtml(row.name)}</strong>
    <span class="muted">${escapeHtml(row.address)}</span>
  </button>`;
}

function newsCard(row) {
  return `<article class="card" style="cursor:default">
    <span class="tag">${escapeHtml(row.author)}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <p>${escapeHtml(row.body)}</p>
  </article>`;
}

function resourceCard(row) {
  const link = row.url
    ? `<a href="${escapeAttr(row.url)}" target="_blank" rel="noopener">${t().website}</a>`
    : "";
  const phone = row.phone ? `<a href="tel:${escapeAttr(row.phone)}">${escapeHtml(row.phone)}</a>` : "";
  return `<article class="card" style="cursor:default">
    <span class="tag">${t().resCats[row.category] || row.category}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <p>${escapeHtml(row.description)}</p>
    <span class="muted">${escapeHtml(row.address || "")}</span>
    <span>${[phone, link].filter(Boolean).join(" · ")}</span>
  </article>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

async function renderHome() {
  const [counts, listings, news] = await Promise.all([
    api("/api/stats"),
    api("/api/listings"),
    api("/api/news"),
  ]);
  return `<section class="hero">
    <div>
      <p class="kicker">${t().heroKicker}</p>
      <h1>${t().heroTitle}</h1>
      <p class="lede">${t().heroLede}</p>
    </div>
    <div class="stats">
      <div class="stat"><b>${counts.listings}</b>${t().listings}</div>
      <div class="stat"><b>${counts.businesses}</b>${t().businesses}</div>
      <div class="stat"><b>${counts.news}</b>${t().news}</div>
      <div class="stat"><b>${counts.resources}</b>${t().resources}</div>
    </div>
  </section>
  <section>
    <div class="toolbar"><h2>${t().latestBoard}</h2><a href="#/board" data-link>${t().seeBoard}</a></div>
    <div class="grid">${listings.slice(0, 4).map(listingCard).join("")}</div>
  </section>
  <section>
    <div class="toolbar"><h2>${t().latestNews}</h2><a href="#/news" data-link>${t().seeNews}</a></div>
    <div class="grid">${news.slice(0, 3).map(newsCard).join("")}</div>
  </section>`;
}

async function renderBoard() {
  const q = state.listingCategory ? `?category=${state.listingCategory}` : "";
  const rows = await api(`/api/listings${q}`);
  return `<p class="kicker">${t().navBoard}</p><h1>${t().listings}</h1>
    ${chips(t().listingCats, state.listingCategory, "listing")}
    <div class="grid">${rows.map(listingCard).join("")}</div>`;
}

async function renderDirectory() {
  const q = state.businessCategory ? `?category=${state.businessCategory}` : "";
  const rows = await api(`/api/businesses${q}`);
  return `<p class="kicker">${t().navDirectory}</p><h1>${t().businesses}</h1>
    <p><button type="button" class="primary" data-open-post data-tab="business">${t().addCompany}</button></p>
    ${chips(t().bizCats, state.businessCategory, "business")}
    <div class="grid">${rows.map(businessCard).join("")}</div>`;
}

async function renderNews() {
  const rows = await api("/api/news");
  return `<p class="kicker">${t().navNews}</p><h1>${t().news}</h1>
    <div class="grid">${rows.map(newsCard).join("")}</div>`;
}

async function renderResources() {
  const rows = await api("/api/resources");
  return `<p class="kicker">${t().navResources}</p><h1>${t().resources}</h1>
    <div class="grid">${rows.map(resourceCard).join("")}</div>`;
}

function renderAbout() {
  return `<p class="kicker">34956</p><h1>${t().aboutTitle}</h1>
    <div class="prose">${t().aboutBody.map((p) => `<p>${p}</p>`).join("")}
    <p class="note">Village of Indiantown · <a href="https://www.indiantownfl.gov/" target="_blank" rel="noopener">indiantownfl.gov</a> · (772) 597-9900</p></div>`;
}

async function renderDetail(kind, id) {
  const row = await api(`/api/${kind === "listing" ? "listings" : "businesses"}/${id}`);
  if (kind === "listing") {
    return `<p><a href="#/board" data-link>${t().back}</a></p>
      <article class="detail">
        <span class="tag">${t().listingCats[row.category]}</span>
        <h1>${escapeHtml(row.title)}</h1>
        <p class="price">${money(row.price_cents)}</p>
        <p>${escapeHtml(row.description)}</p>
        <p class="muted">${escapeHtml(row.neighborhood)}</p>
        <div class="contact-box">
          <strong>${escapeHtml(row.contact_name)}</strong>
          <p><a href="tel:${escapeAttr(row.phone)}">${t().call} ${escapeHtml(row.phone)}</a></p>
          <p><a href="mailto:${escapeAttr(row.email)}">${t().email} ${escapeHtml(row.email)}</a></p>
        </div>
      </article>`;
  }
  return `<p><a href="#/directory" data-link>${t().back}</a></p>
    <article class="detail">
      <span class="tag">${t().bizCats[row.category]}</span>
      <h1>${escapeHtml(row.name)}</h1>
      <p>${escapeHtml(row.description)}</p>
      <p class="muted">${escapeHtml(row.address)}</p>
      <div class="contact-box">
        <strong>${escapeHtml(row.owner_name)}</strong>
        <p><a href="tel:${escapeAttr(row.phone)}">${t().call} ${escapeHtml(row.phone)}</a></p>
        <p><a href="mailto:${escapeAttr(row.email)}">${t().email} ${escapeHtml(row.email)}</a></p>
        ${row.website ? `<p><a href="${escapeAttr(row.website)}" target="_blank" rel="noopener">${t().website}</a></p>` : ""}
      </div>
    </article>`;
}

const routes = {
  "": renderHome,
  board: renderBoard,
  directory: renderDirectory,
  news: renderNews,
  resources: renderResources,
  about: renderAbout,
};

async function render() {
  applyChrome();
  const [page, kind, id] = (location.hash.slice(2) || "").split("/");
  const main = $("#main");
  main.innerHTML = "<p class='muted'>…</p>";
  try {
    if (kind && id && (page === "listing" || page === "business")) {
      main.innerHTML = await renderDetail(page, id);
    } else {
      main.innerHTML = await (routes[page] || renderHome)();
    }
  } catch (error) {
    main.innerHTML = `<p class="status" data-state="error">${escapeHtml(error.error || error.message || "Error")}</p>`;
  }
  applyChrome();
}

function field(name, label, type = "text", extra = "") {
  if (type === "textarea") {
    return `<label>${label}<textarea name="${name}" ${extra}></textarea></label>`;
  }
  if (type === "select") return `<label>${label}<select name="${name}">${extra}</select></label>`;
  return `<label>${label}<input name="${name}" type="${type}" ${extra} /></label>`;
}

function listingForm() {
  const f = t().form;
  return `<form class="stack" data-form="listing">
    ${field("title", f.title)}
    ${field("category", f.category, "select", options(t().listingCats, "for-sale"))}
    ${field("description", f.description, "textarea")}
    ${field("price", f.price)}
    ${field("contact_name", f.contact)}
    ${field("phone", f.phone, "tel")}
    ${field("email", f.email, "email")}
    ${field("neighborhood", f.neighborhood)}
    <button class="primary" type="submit">${f.submitListing}</button>
    <p class="status" data-form-status></p>
  </form>`;
}

function businessForm() {
  const f = t().form;
  return `<form class="stack" data-form="business">
    ${field("name", f.name)}
    ${field("category", f.category, "select", options(t().bizCats, "other"))}
    ${field("description", f.description, "textarea")}
    ${field("owner_name", f.owner)}
    ${field("phone", f.phone, "tel")}
    ${field("email", f.email, "email")}
    ${field("website", f.website, "url")}
    ${field("address", f.address)}
    <button class="primary" type="submit">${f.submitBusiness}</button>
    <p class="status" data-form-status></p>
  </form>`;
}

function newsForm() {
  const f = t().form;
  return `<form class="stack" data-form="news">
    ${field("title", f.title)}
    ${field("body", f.body, "textarea")}
    ${field("author", f.author)}
    <button class="primary" type="submit">${f.submitNews}</button>
    <p class="status" data-form-status></p>
  </form>`;
}

function paintSheet() {
  const body = $("[data-sheet-body]");
  body.innerHTML =
    state.sheetTab === "business" ? businessForm() : state.sheetTab === "news" ? newsForm() : listingForm();
  $$("[data-sheet-tab]").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.sheetTab === state.sheetTab));
  $("[data-sheet-title]").textContent = t().post;
}

function openSheet(tab) {
  if (tab) state.sheetTab = tab;
  paintSheet();
  $("[data-sheet]").showModal();
}

document.addEventListener("click", (event) => {
  const lang = event.target.closest("[data-lang-toggle]");
  if (lang) {
    state.lang = state.lang === "en" ? "es" : "en";
    localStorage.setItem("it-lang", state.lang);
    paintSheet();
    render();
    return;
  }
  const post = event.target.closest("[data-open-post]");
  if (post) {
    openSheet(post.dataset.tab || "listing");
    return;
  }
  const tab = event.target.closest("[data-sheet-tab]");
  if (tab) {
    state.sheetTab = tab.dataset.sheetTab;
    paintSheet();
    return;
  }
  const chip = event.target.closest("[data-chip]");
  if (chip) {
    const group = chip.parentElement.dataset.chips;
    if (group === "listing") state.listingCategory = chip.dataset.chip;
    if (group === "business") state.businessCategory = chip.dataset.chip;
    render();
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) {
    location.hash = `#/${open.dataset.open}/${open.dataset.id}`;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const status = $("[data-form-status]", form);
  const data = Object.fromEntries(new FormData(form));
  const path =
    form.dataset.form === "business"
      ? "/api/businesses"
      : form.dataset.form === "news"
        ? "/api/news"
        : "/api/listings";
  try {
    await api(path, { method: "POST", body: JSON.stringify(data) });
    status.dataset.state = "ok";
    status.textContent = t().posted;
    form.reset();
    render();
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error.error || t().needFix;
  }
});

window.addEventListener("hashchange", render);
paintSheet();
render();
