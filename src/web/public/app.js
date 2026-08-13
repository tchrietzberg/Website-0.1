import { parseHash } from "./routes.js";

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
    menu: "Menu",
    search: "Search",
    searchLabel: "Search Indiantown",
    searchPh: "Search listings, businesses, news…",
    tabListing: "Listing",
    tabBusiness: "Business",
    tabNews: "News",
    footer:
      "Indiantown Board is a community bulletin for 34956. It is a standalone site and is not part of any other app.",
    heroKicker: "Village of Indiantown · Treasure Coast",
    heroTitle: "Find it in 34956.",
    heroLede: "Buy, sell, hire, or list your company — only for people in and around Indiantown.",
    listings: "Listings",
    businesses: "Businesses",
    news: "News notes",
    resources: "Resources",
    latestBoard: "Latest on the board",
    latestNews: "Town notes",
    seeBoard: "See all listings",
    seeNews: "All news",
    addCompany: "Add your company",
    all: "All",
    results: "Results",
    empty: "Nothing matches yet. Try another word, or post it yourself.",
    actionListing: "Post a listing",
    actionListingHint: "For sale, jobs, housing, help",
    actionBiz: "Add a company",
    actionBizHint: "Name, phone, and address",
    actionHelp: "Get help",
    actionHelpHint: "Village, utilities, 211, 911",
    reveal: "Show contact",
    hide: "Hide contact",
    agree: "I confirm this is a real local post for Indiantown, not spam.",
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
      "Indiantown is a rural village in Martin County on Florida’s Treasure Coast. It was incorporated on December 31, 2017 and is home to about 6,000 people.",
      "Village Hall is at 15516 SW Osceola St., Suite B. Official business stays on indiantownfl.gov. This board is independent of Village government.",
      "Search first. Then post a listing, add a company, or share a short town note. Contact details stay hidden until someone asks to see them.",
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
    needFix: "Check the fields and try again.",
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
    menu: "Menú",
    search: "Buscar",
    searchLabel: "Buscar en Indiantown",
    searchPh: "Buscar anuncios, negocios, noticias…",
    tabListing: "Anuncio",
    tabBusiness: "Negocio",
    tabNews: "Noticia",
    footer:
      "El Tablón de Indiantown es un boletín comunitario para el 34956. Es un sitio independiente y no forma parte de ninguna otra aplicación.",
    heroKicker: "Villa de Indiantown · Treasure Coast",
    heroTitle: "Encuéntrelo en el 34956.",
    heroLede: "Compre, venda, contrate o registre su empresa — solo para gente de Indiantown y alrededores.",
    listings: "Anuncios",
    businesses: "Negocios",
    news: "Notas",
    resources: "Recursos",
    latestBoard: "Lo último en el tablón",
    latestNews: "Notas del pueblo",
    seeBoard: "Ver todos los anuncios",
    seeNews: "Todas las noticias",
    addCompany: "Agregar su empresa",
    all: "Todo",
    results: "Resultados",
    empty: "Nada coincide. Pruebe otra palabra o publíquelo usted.",
    actionListing: "Publicar anuncio",
    actionListingHint: "Se vende, empleos, vivienda, ayuda",
    actionBiz: "Agregar empresa",
    actionBizHint: "Nombre, teléfono y dirección",
    actionHelp: "Pedir ayuda",
    actionHelpHint: "Pueblo, servicios, 211, 911",
    reveal: "Mostrar contacto",
    hide: "Ocultar contacto",
    agree: "Confirmo que esta es una publicación local real de Indiantown, no spam.",
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
      "Indiantown es un pueblo rural en el condado de Martin, en la Treasure Coast de la Florida. Se incorporó el 31 de diciembre de 2017 y tiene unos 6,000 residentes.",
      "La alcaldía está en 15516 SW Osceola St., Suite B. Los trámites oficiales siguen en indiantownfl.gov. Este tablón es independiente del gobierno municipal.",
      "Busque primero. Luego publique un anuncio, agregue una empresa o comparta una nota. Los datos de contacto se ocultan hasta que alguien pida verlos.",
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
    needFix: "Revise los campos e intente de nuevo.",
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
  query: "",
  csrf: "",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = () => copy[state.lang];

async function loadSession() {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  const data = await res.json();
  state.csrf = data.csrf;
}

function applyChrome() {
  document.documentElement.lang = state.lang;
  $$("[data-i18n]").forEach((el) => {
    if (t()[el.dataset.i18n]) el.textContent = t()[el.dataset.i18n];
  });
  $$("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (t()[key]) el.placeholder = t()[key];
  });
  $("[data-lang-toggle]").textContent = state.lang === "en" ? "ES" : "EN";
  const hash = location.hash.slice(2).split("/")[0] || "";
  $$(".nav a").forEach((a) => {
    const href = a.getAttribute("href").slice(2);
    a.classList.toggle("is-on", href === hash || (href === "" && hash === ""));
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.method === "POST" ? { "X-CSRF-Token": state.csrf } : {}),
      ...options.headers,
    },
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
  return `<div class="chips" data-chips="${on}">${all}${rest}</div>`;
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

function gridOrEmpty(html) {
  return html ? `<div class="grid">${html}</div>` : `<p class="empty">${t().empty}</p>`;
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
  <div class="actions">
    <button class="action" type="button" data-open-post data-tab="listing"><strong>${t().actionListing}</strong><span>${t().actionListingHint}</span></button>
    <button class="action" type="button" data-open-post data-tab="business"><strong>${t().actionBiz}</strong><span>${t().actionBizHint}</span></button>
    <a class="action" href="#/resources" data-link><strong>${t().actionHelp}</strong><span>${t().actionHelpHint}</span></a>
  </div>
  <section>
    <div class="toolbar"><h2>${t().latestBoard}</h2><a href="#/board" data-link>${t().seeBoard}</a></div>
    ${gridOrEmpty(listings.slice(0, 4).map(listingCard).join(""))}
  </section>
  <section>
    <div class="toolbar"><h2>${t().latestNews}</h2><a href="#/news" data-link>${t().seeNews}</a></div>
    ${gridOrEmpty(news.slice(0, 3).map(newsCard).join(""))}
  </section>`;
}

async function renderBoard() {
  const q = state.listingCategory ? `?category=${encodeURIComponent(state.listingCategory)}` : "";
  const rows = await api(`/api/listings${q}`);
  return `<p class="kicker">${t().navBoard}</p><h1>${t().listings}</h1>
    ${chips(t().listingCats, state.listingCategory, "listing")}
    ${gridOrEmpty(rows.map(listingCard).join(""))}`;
}

async function renderDirectory() {
  const q = state.businessCategory ? `?category=${encodeURIComponent(state.businessCategory)}` : "";
  const rows = await api(`/api/businesses${q}`);
  return `<p class="kicker">${t().navDirectory}</p><h1>${t().businesses}</h1>
    <p><button type="button" class="primary" data-open-post data-tab="business">${t().addCompany}</button></p>
    ${chips(t().bizCats, state.businessCategory, "business")}
    ${gridOrEmpty(rows.map(businessCard).join(""))}`;
}

async function renderNews() {
  const rows = await api("/api/news");
  return `<p class="kicker">${t().navNews}</p><h1>${t().news}</h1>
    ${gridOrEmpty(rows.map(newsCard).join(""))}`;
}

async function renderResources() {
  const rows = await api("/api/resources");
  return `<p class="kicker">${t().navResources}</p><h1>${t().resources}</h1>
    ${gridOrEmpty(rows.map(resourceCard).join(""))}`;
}

function renderAbout() {
  return `<p class="kicker">34956</p>
    <img class="about-seal" src="/village-seal.png" width="160" height="160" alt="Village of Indiantown, Florida official seal" />
    <h1>${t().aboutTitle}</h1>
    <div class="prose">${t().aboutBody.map((p) => `<p>${p}</p>`).join("")}
    <p class="note">Village of Indiantown · <a href="https://www.indiantownfl.gov/" target="_blank" rel="noopener">indiantownfl.gov</a> · (772) 597-9900</p></div>`;
}

async function renderSearch() {
  const data = await api(`/api/search?q=${encodeURIComponent(state.query)}`);
  return `<p class="kicker">${t().search}</p><h1>${t().results}</h1>
    <p class="muted">${escapeHtml(state.query)}</p>
    <h2>${t().listings}</h2>${gridOrEmpty(data.listings.map(listingCard).join(""))}
    <h2>${t().businesses}</h2>${gridOrEmpty(data.businesses.map(businessCard).join(""))}
    <h2>${t().news}</h2>${gridOrEmpty(data.news.map(newsCard).join(""))}
    <h2>${t().resources}</h2>${gridOrEmpty(data.resources.map(resourceCard).join(""))}`;
}

function contactBlock(row, kind) {
  const name = kind === "listing" ? row.contact_name : row.owner_name;
  return `<div class="contact-box">
    <strong>${escapeHtml(name)}</strong>
    <p><button type="button" class="ghost" data-reveal>${t().reveal}</button></p>
    <div hidden data-contact>
      <p><a href="tel:${escapeAttr(row.phone)}">${t().call} ${escapeHtml(row.phone)}</a></p>
      <p><a href="mailto:${escapeAttr(row.email)}">${t().email} ${escapeHtml(row.email)}</a></p>
      ${row.website ? `<p><a href="${escapeAttr(row.website)}" target="_blank" rel="noopener">${t().website}</a></p>` : ""}
    </div>
  </div>`;
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
        ${contactBlock(row, "listing")}
      </article>`;
  }
  return `<p><a href="#/directory" data-link>${t().back}</a></p>
    <article class="detail">
      <span class="tag">${t().bizCats[row.category]}</span>
      <h1>${escapeHtml(row.name)}</h1>
      <p>${escapeHtml(row.description)}</p>
      <p class="muted">${escapeHtml(row.address)}</p>
      ${contactBlock(row, "business")}
    </article>`;
}

const routes = {
  "": renderHome,
  board: renderBoard,
  directory: renderDirectory,
  news: renderNews,
  resources: renderResources,
  about: renderAbout,
  search: renderSearch,
};

async function render() {
  applyChrome();
  const { page, id } = parseHash(location.hash);
  const main = $("#main");
  main.innerHTML = "<p class='muted'>…</p>";
  try {
    if ((page === "listing" || page === "business") && id) {
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
  if (type === "textarea") return `<label>${label}<textarea name="${name}" ${extra}></textarea></label>`;
  if (type === "select") return `<label>${label}<select name="${name}">${extra}</select></label>`;
  return `<label>${label}<input name="${name}" type="${type}" ${extra} /></label>`;
}

function honeypotAndAgree() {
  return `<label class="hp">Fax<input name="fax" tabindex="-1" autocomplete="off" /></label>
    <label class="check"><input name="agree" type="checkbox" required /> <span>${t().agree}</span></label>`;
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
    ${honeypotAndAgree()}
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
    ${honeypotAndAgree()}
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
    ${honeypotAndAgree()}
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
  const menu = event.target.closest("[data-menu-toggle]");
  if (menu) {
    const nav = $("[data-nav]");
    const open = nav.classList.toggle("is-open");
    menu.setAttribute("aria-expanded", String(open));
    return;
  }
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
  const reveal = event.target.closest("[data-reveal]");
  if (reveal) {
    const box = reveal.closest(".contact-box");
    const hidden = $("[data-contact]", box);
    hidden.hidden = !hidden.hidden;
    reveal.textContent = hidden.hidden ? t().reveal : t().hide;
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) location.hash = `#/${open.dataset.open}/${open.dataset.id}`;
});

document.addEventListener("submit", async (event) => {
  const search = event.target.closest("[data-search-form]");
  if (search) {
    event.preventDefault();
    state.query = String(new FormData(search).get("q") || "").trim();
    location.hash = "#/search";
    render();
    return;
  }
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
    if (!state.csrf) await loadSession();
    await api(path, { method: "POST", body: JSON.stringify(data) });
    status.dataset.state = "ok";
    status.textContent = t().posted;
    form.reset();
    $("[data-sheet]")?.close();
    render();
  } catch (error) {
    if (error.error && /token/i.test(error.error)) await loadSession();
    status.dataset.state = "error";
    status.textContent = error.error || t().needFix;
  }
});

if (typeof document !== "undefined") {
  window.addEventListener("hashchange", render);
  await loadSession();
  paintSheet();
  render();
}
