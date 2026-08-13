import { parseHash } from "./routes.js";

const copy = {
  en: {
    brand: "Indiantown Board",
    navHome: "Home",
    navBoard: "Listings",
    navDirectory: "Businesses",
    navNews: "News",
    navChat: "Chat",
    navResources: "Help",
    navAbout: "About",
    post: "Post",
    menu: "Menu",
    search: "Search",
    searchLabel: "Search Indiantown",
    searchPh: "Search…",
    tabListing: "Listing",
    tabBusiness: "Business",
    tabNews: "News",
    tabRoom: "Chat room",
    footer: "Village of Indiantown, Florida · 34956",
    heroKicker: "Village of Indiantown",
    heroTitle: "Welcome to Indiantown",
    heroLede: "Buy, sell, hire, or find a local business.",
    listings: "Listings",
    businesses: "Businesses",
    news: "News",
    resources: "Help",
    rooms: "Chat rooms",
    requestRoom: "Request a room",
    pendingNote: "An admin must approve a new room before people can chat.",
    roomRequested: "Requested. An admin will review it.",
    joinName: "Your name in this room",
    send: "Send",
    openRoom: "Open",
    approve: "Approve",
    closeRoom: "Close room",
    hideMsg: "Hide",
    adminTitle: "Admin review",
    adminEmail: "Admin email",
    adminPassword: "Password",
    signIn: "Sign in",
    signOut: "Sign out",
    pending: "Pending",
    approved: "Open",
    closed: "Closed",
    actionChat: "Join a chat",
    actionChatHint: "Topic rooms after admin approval",
    latestBoard: "Latest listings",
    latestNews: "Latest news",
    seeBoard: "See all",
    seeNews: "See all",
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
    roomTopics: {
      community: "Community",
      events: "Events",
      jobs: "Jobs",
      housing: "Housing",
      help: "Help",
      youth: "Youth",
      spanish: "Español",
      other: "Other",
    },
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
    resourceIntro: "Official Village, county, and local contacts. Call 911 if someone is in danger.",
    resCats: {
      safety: "Safety",
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
      "Village Hall is at 15516 SW Osceola St., Suite B. Official business stays on indiantownfl.gov.",
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
      submitRoom: "Request room",
      topic: "Topic",
      host: "Your name",
    },
    posted: "Posted. It is live now.",
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
    navBoard: "Anuncios",
    navDirectory: "Negocios",
    navNews: "Noticias",
    navChat: "Chat",
    navResources: "Ayuda",
    navAbout: "Acerca",
    post: "Publicar",
    menu: "Menú",
    search: "Buscar",
    searchLabel: "Buscar en Indiantown",
    searchPh: "Buscar…",
    tabListing: "Anuncio",
    tabBusiness: "Negocio",
    tabNews: "Noticia",
    tabRoom: "Sala",
    footer: "Villa de Indiantown, Florida · 34956",
    heroKicker: "Villa de Indiantown",
    heroTitle: "Bienvenido a Indiantown",
    heroLede: "Compre, venda, contrate o encuentre un negocio local.",
    listings: "Anuncios",
    businesses: "Negocios",
    news: "Noticias",
    resources: "Ayuda",
    rooms: "Salas de chat",
    requestRoom: "Pedir una sala",
    pendingNote: "Un administrador debe aprobar la sala antes de que la gente pueda hablar.",
    roomRequested: "Solicitada. Un administrador la revisará.",
    joinName: "Su nombre en esta sala",
    send: "Enviar",
    openRoom: "Abrir",
    approve: "Aprobar",
    closeRoom: "Cerrar sala",
    hideMsg: "Ocultar",
    adminTitle: "Revisión de administrador",
    adminEmail: "Correo de administrador",
    adminPassword: "Contraseña",
    signIn: "Entrar",
    signOut: "Salir",
    pending: "Pendiente",
    approved: "Abierta",
    closed: "Cerrada",
    actionChat: "Entrar a un chat",
    actionChatHint: "Salas por tema, con aprobación",
    latestBoard: "Anuncios recientes",
    latestNews: "Noticias recientes",
    seeBoard: "Ver todos",
    seeNews: "Ver todas",
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
    roomTopics: {
      community: "Comunidad",
      events: "Eventos",
      jobs: "Empleos",
      housing: "Vivienda",
      help: "Ayuda",
      youth: "Jóvenes",
      spanish: "Español",
      other: "Otro",
    },
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
    resourceIntro: "Contactos oficiales del pueblo, el condado y la zona. Llame al 911 si hay peligro.",
    resCats: {
      safety: "Seguridad",
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
      "La alcaldía está en 15516 SW Osceola St., Suite B. Los trámites oficiales siguen en indiantownfl.gov.",
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
      submitRoom: "Pedir sala",
      topic: "Tema",
      host: "Su nombre",
    },
    posted: "Publicado. Ya está en línea.",
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
  roomTopic: "",
  resourceCategory: "",
  query: "",
  csrf: "",
  admin: false,
  chatName: localStorage.getItem("it-chat-name") || "",
  poll: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const t = () => copy[state.lang];

async function loadSession() {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  const data = await res.json();
  state.csrf = data.csrf;
  state.admin = Boolean(data.admin);
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

function excerpt(text, n = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= n) return value;
  return `${value.slice(0, n).trim()}…`;
}

function listingCard(row) {
  return `<button class="card" data-open="listing" data-id="${row.id}">
    <span class="tag">${t().listingCats[row.category] || row.category}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <span class="blurb">${escapeHtml(excerpt(row.description))}</span>
    <span class="meta"><b class="price">${money(row.price_cents)}</b> · ${escapeHtml(row.neighborhood)}</span>
  </button>`;
}

function businessCard(row) {
  return `<button class="card" data-open="business" data-id="${row.id}">
    <span class="tag">${t().bizCats[row.category] || row.category}</span>
    <strong>${escapeHtml(row.name)}</strong>
    <span class="blurb">${escapeHtml(excerpt(row.description))}</span>
    <span class="meta">${escapeHtml(row.address)}</span>
  </button>`;
}

function newsCard(row) {
  return `<article class="card is-static">
    <span class="tag">${escapeHtml(row.author)}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <p class="blurb">${escapeHtml(excerpt(row.body, 140))}</p>
  </article>`;
}

function resourceCard(row) {
  const link = row.url
    ? `<a href="${escapeAttr(row.url)}" target="_blank" rel="noopener">${t().website}</a>`
    : "";
  const phone = row.phone
    ? `<a class="phone-link" href="tel:${escapeAttr(row.phone)}">${escapeHtml(row.phone)}</a>`
    : "";
  return `<article class="card is-static">
    <span class="tag">${t().resCats[row.category] || row.category}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <p class="blurb">${escapeHtml(row.description)}</p>
    ${phone}
    <span class="muted">${escapeHtml(row.address || "")}</span>
    ${link}
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
    <p class="statline">
      <span><b>${counts.listings}</b> ${t().listings}</span>
      <span><b>${counts.businesses}</b> ${t().businesses}</span>
      <span><b>${counts.news}</b> ${t().news}</span>
      <span><b>${counts.resources}</b> ${t().resources}</span>
      <span><b>${counts.rooms || 0}</b> ${t().rooms}</span>
    </p>
  </section>
  <div class="actions">
    <button class="action" type="button" data-open-post data-tab="listing"><strong>${t().actionListing}</strong><span>${t().actionListingHint}</span></button>
    <button class="action" type="button" data-open-post data-tab="business"><strong>${t().actionBiz}</strong><span>${t().actionBizHint}</span></button>
    <a class="action" href="#/chat" data-link><strong>${t().actionChat}</strong><span>${t().actionChatHint}</span></a>
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
  const q = state.resourceCategory ? `?category=${encodeURIComponent(state.resourceCategory)}` : "";
  const rows = await api(`/api/resources${q}`);
  return `<p class="kicker">${t().navResources}</p><h1>${t().resources}</h1>
    <p class="lede">${t().resourceIntro}</p>
    ${chips(t().resCats, state.resourceCategory, "resource")}
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
    <h2>${t().resources}</h2>${gridOrEmpty(data.resources.map(resourceCard).join(""))}
    <h2>${t().rooms}</h2>${gridOrEmpty((data.rooms || []).map(roomCard).join(""))}`;
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

function roomCard(row) {
  return `<button class="card" data-open="chat" data-id="${row.id}">
    <span class="tag">${t().roomTopics[row.topic] || row.topic}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <span class="blurb">${escapeHtml(excerpt(row.description))}</span>
    <span class="meta">${row.message_count || 0} · ${escapeHtml(row.host_name)}</span>
  </button>`;
}

async function renderChat() {
  const q = state.roomTopic ? `?topic=${encodeURIComponent(state.roomTopic)}` : "";
  const rows = await api(`/api/rooms${q}`);
  return `<p class="kicker">${t().navChat}</p><h1>${t().rooms}</h1>
    <p class="lede">${t().pendingNote}</p>
    <p><button type="button" class="primary" data-open-post data-tab="room">${t().requestRoom}</button>
    <a href="#/admin" data-link>${t().adminTitle}</a></p>
    ${chips(t().roomTopics, state.roomTopic, "room")}
    ${gridOrEmpty(rows.map(roomCard).join(""))}`;
}

function messageLine(row) {
  const hidden = Number(row.hidden) === 1;
  return `<div class="msg ${hidden ? "is-hidden" : ""}">
    <strong>${escapeHtml(row.author)}</strong>
    <p>${escapeHtml(row.body)}</p>
    ${state.admin && !hidden ? `<button type="button" class="ghost" data-hide-msg="${row.id}">${t().hideMsg}</button>` : ""}
  </div>`;
}

async function renderChatRoom(id) {
  const [room, messages] = await Promise.all([
    api(`/api/rooms/${id}`),
    api(`/api/rooms/${id}/messages`),
  ]);
  return `<p><a href="#/chat" data-link>${t().back}</a></p>
    <article class="detail">
      <span class="tag">${t().roomTopics[room.topic] || room.topic}</span>
      <h1>${escapeHtml(room.title)}</h1>
      <p>${escapeHtml(room.description)}</p>
      <div class="chat-log" data-chat-log data-room-id="${room.id}">${messages.map(messageLine).join("")}</div>
      <form class="stack chat-form" data-chat-form data-room-id="${room.id}">
        ${field("author", t().joinName, "text", `value="${escapeAttr(state.chatName)}" required`)}
        ${field("body", t().form.body, "text", "required maxlength=\"500\"")}
        <button class="primary" type="submit">${t().send}</button>
        <p class="status" data-form-status></p>
      </form>
    </article>`;
}

async function renderAdmin() {
  if (!state.admin) {
    return `<p class="kicker">${t().adminTitle}</p><h1>${t().signIn}</h1>
      <form class="stack" data-admin-login>
        ${field("email", t().adminEmail, "email", "required")}
        ${field("password", t().adminPassword, "password", "required")}
        <button class="primary" type="submit">${t().signIn}</button>
        <p class="status" data-form-status></p>
      </form>`;
  }
  const rows = await api("/api/admin/rooms");
  return `<p class="kicker">${t().adminTitle}</p>
    <div class="toolbar"><h1>${t().rooms}</h1>
    <button type="button" class="ghost" data-admin-logout>${t().signOut}</button></div>
    ${rows
      .map(
        (row) => `<article class="card is-static">
        <span class="tag">${t()[row.status] || row.status} · ${t().roomTopics[row.topic] || row.topic}</span>
        <strong>${escapeHtml(row.title)}</strong>
        <p class="blurb">${escapeHtml(row.description)}</p>
        <span class="meta">${escapeHtml(row.host_name)} · ${escapeHtml(row.host_email)}</span>
        <p>
          ${row.status === "pending" ? `<button type="button" class="primary" data-admin-room="${row.id}" data-admin-action="approve">${t().approve}</button>` : ""}
          ${row.status === "approved" ? `<button type="button" class="ghost" data-admin-room="${row.id}" data-admin-action="close">${t().closeRoom}</button>` : ""}
          ${row.status === "approved" ? `<a href="#/chat/${row.id}" data-link>${t().openRoom}</a>` : ""}
        </p>
      </article>`,
      )
      .join("")}`;
}

const routes = {
  "": renderHome,
  board: renderBoard,
  directory: renderDirectory,
  news: renderNews,
  resources: renderResources,
  about: renderAbout,
  search: renderSearch,
  chat: renderChat,
  admin: renderAdmin,
};

function stopPoll() {
  if (state.poll) {
    clearInterval(state.poll);
    state.poll = null;
  }
}

function startPoll(roomId) {
  stopPoll();
  state.poll = setInterval(async () => {
    const log = $("[data-chat-log]");
    if (!log || log.dataset.roomId !== String(roomId)) {
      stopPoll();
      return;
    }
    try {
      const messages = await api(`/api/rooms/${roomId}/messages`);
      log.innerHTML = messages.map(messageLine).join("");
    } catch {
      /* keep the last good log */
    }
  }, 2500);
}

async function render() {
  applyChrome();
  stopPoll();
  const { page, id } = parseHash(location.hash);
  const main = $("#main");
  main.innerHTML = "<p class='muted'>…</p>";
  try {
    if ((page === "listing" || page === "business") && id) {
      main.innerHTML = await renderDetail(page, id);
    } else if (page === "chat" && id) {
      main.innerHTML = await renderChatRoom(id);
      startPoll(id);
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

function roomForm() {
  const f = t().form;
  return `<form class="stack" data-form="room">
    ${field("title", f.title)}
    ${field("topic", f.topic, "select", options(t().roomTopics, "community"))}
    ${field("description", f.description, "textarea")}
    ${field("host_name", f.host)}
    ${field("host_email", f.email, "email")}
    ${honeypotAndAgree()}
    <button class="primary" type="submit">${f.submitRoom}</button>
    <p class="status" data-form-status></p>
  </form>`;
}

function paintSheet() {
  const body = $("[data-sheet-body]");
  const forms = { business: businessForm, news: newsForm, room: roomForm, listing: listingForm };
  body.innerHTML = (forms[state.sheetTab] || listingForm)();
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
    if (group === "room") state.roomTopic = chip.dataset.chip;
    if (group === "resource") state.resourceCategory = chip.dataset.chip;
    render();
    return;
  }
  const hideMsg = event.target.closest("[data-hide-msg]");
  if (hideMsg) {
    api(`/api/admin/messages/${hideMsg.dataset.hideMsg}/hide`, { method: "POST", body: "{}" })
      .then(() => render())
      .catch(() => {});
    return;
  }
  const adminRoom = event.target.closest("[data-admin-room]");
  if (adminRoom) {
    api(`/api/admin/rooms/${adminRoom.dataset.adminRoom}/${adminRoom.dataset.adminAction}`, {
      method: "POST",
      body: "{}",
    })
      .then(() => render())
      .catch(() => {});
    return;
  }
  const logout = event.target.closest("[data-admin-logout]");
  if (logout) {
    api("/api/admin/logout", { method: "POST", body: "{}" })
      .then(async () => {
        await loadSession();
        render();
      })
      .catch(() => {});
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
  const adminLogin = event.target.closest("[data-admin-login]");
  if (adminLogin) {
    event.preventDefault();
    const status = $("[data-form-status]", adminLogin);
    const data = Object.fromEntries(new FormData(adminLogin));
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify(data) });
      await loadSession();
      render();
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.error || t().needFix;
    }
    return;
  }
  const chatForm = event.target.closest("[data-chat-form]");
  if (chatForm) {
    event.preventDefault();
    const status = $("[data-form-status]", chatForm);
    const data = Object.fromEntries(new FormData(chatForm));
    state.chatName = String(data.author || "").trim();
    localStorage.setItem("it-chat-name", state.chatName);
    try {
      await api(`/api/rooms/${chatForm.dataset.roomId}/messages`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      chatForm.elements.namedItem("body").value = "";
      const messages = await api(`/api/rooms/${chatForm.dataset.roomId}/messages`);
      $("[data-chat-log]").innerHTML = messages.map(messageLine).join("");
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.error || t().needFix;
    }
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
        : form.dataset.form === "room"
          ? "/api/rooms"
          : "/api/listings";
  try {
    if (!state.csrf) await loadSession();
    await api(path, { method: "POST", body: JSON.stringify(data) });
    status.dataset.state = "ok";
    status.textContent = form.dataset.form === "room" ? t().roomRequested : t().posted;
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
