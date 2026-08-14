import { parseHash } from "./routes.js";

const copy = {
  en: {
    brand: "Indiantown Board",
    navHome: "Home",
    navHomes: "Homes",
    navBoard: "Listings",
    navDirectory: "Businesses",
    navNews: "News",
    navChat: "Chat",
    navResources: "Help",
    navAbout: "About",
    post: "Post",
    menu: "Menu",
    search: "Search",
    langLabel: "Language",
    searchLabel: "Search Indiantown",
    searchPh: "Search…",
    tabListing: "Listing",
    tabBusiness: "Business",
    tabNews: "News",
    tabRoom: "Chat room",
    footer: "Village of Indiantown, Florida · 34956",
    heroKicker: "Treasure Coast · 34956",
    heroTitle: "Find your place in Indiantown",
    heroLede: "Homes on Zillow, neighbor listings, and local help — one village board.",
    actionHomes: "Browse homes",
    actionHomesHint: "Recent Zillow listings in 34956",
    homesTitle: "Homes for sale",
    homesIntro: "Recent Indiantown listings on Zillow. Open a card for photos, price, and the live listing.",
    homesNote: "Price and availability are on Zillow and can change. This board does not sell these homes.",
    zillowAll: "See all on Zillow",
    zillowNewest: "Newest",
    zillowRent: "For rent",
    zillowSold: "Recently sold",
    zillowNew: "New construction",
    viewOnZillow: "View on Zillow",
    localHousing: "Neighbor housing posts",
    bedsBaths: "bd",
    bathsShort: "ba",
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
    readStory: "Read story",
    addCompany: "Add your company",
    all: "All",
    results: "Results",
    empty: "Nothing matches yet. Try another word, or post it yourself.",
    emptyRooms: "No rooms yet. Request one and an admin will review it.",
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
    aboutMotto: "Where Great Things Grow",
    aboutWiki: "Town history and facts are adapted from Wikipedia and U.S. Census figures.",
    aboutWikiLink: "Wikipedia: Indiantown, Florida",
    aboutFacts: [
      { label: "Population (2020)", value: "6,560" },
      { label: "Land", value: "14.2 sq mi" },
      { label: "Settled", value: "1890s" },
      { label: "Incorporated", value: "Dec. 31, 2017" },
      { label: "Elevation", value: "36 ft" },
      { label: "ZIP / area", value: "34956 · 772" },
      { label: "Government", value: "Council–manager" },
      { label: "Time zone", value: "Eastern" },
    ],
    aboutSections: [
      {
        title: "The village",
        body: [
          "Indiantown is a village in western Martin County, in the interior of Florida’s Treasure Coast. About 6,560 people lived here at the 2020 census. The median age was 30. It is a rural community first established in the early 1900s and incorporated on December 31, 2017.",
          "A mayor and a five-member council are elected at-large. A village manager runs day-to-day work. The village motto is “Where Great Things Grow.” Village Hall is at 15516 SW Osceola St., Suite B. Official business stays on indiantownfl.gov.",
        ],
      },
      {
        title: "History",
        body: [
          "Seminole people first used this higher ground as a trading post after the First Seminole War, with hunting and fishing nearby. White American settlers arrived in the 1890s.",
          "In 1924 S. Davies Warfield extended the Seaboard Air Line Railroad from Coleman to West Palm Beach, with a stop in Indiantown, and planned a model city. Warfield Boulevard and Warfield Elementary still carry his name. He built housing, a school, a depot, and the Seminole Inn, now on the National Register of Historic Places. He hoped Indiantown would become the railroad’s southern hub.",
          "The 1920s Florida land boom faded after 1926, Warfield died in 1927, and the 1928 Okeechobee hurricane stopped further growth. In 1952 the Indiantown Company took over local development and added water and sewer, housing, docks on the St. Lucie River, and a 6,000-foot airstrip for small cargo and civilian flights.",
          "In the 1950s and 1960s the Circle T Ranch and Rodeo Bowl drew huge crowds — about 15,000 people in 1963, then one of Florida’s largest attractions. The ranch was later sold and used as a filming studio. Seaboard passenger trains stopped here into the 1960s. Amtrak ended that service in 1971, and the depot was later demolished. The Seminole Inn is the main building left from the 1920s boom.",
        ],
      },
      {
        title: "People and work",
        body: [
          "From the 1980s, Maya families from Guatemala settled here while fleeing civil war and genocide. By around 2010, several thousand Maya lived in and around Indiantown. Many spoke a Mayan language first. Some said the name “Indiantown” itself drew Indigenous families here.",
          "The census count grew from 5,588 in 2000 to 6,083 in 2010 and 6,560 in 2020. In 2020 about 70 percent of residents identified as Hispanic or Latino, 17 percent as White (not Hispanic), and 12 percent as Black. About 32 percent were under 18. There were 1,777 households, and 46 percent of them had children at home.",
          "Seasonal agriculture still anchors the local economy. The village also sits near major roads and works as a small transport hub. Neighbors still talk about bringing the rodeo back and pointing visitors to nearby wetlands.",
        ],
      },
      {
        title: "Place",
        body: [
          "Indiantown is 12 miles east of Port Mayaca on Lake Okeechobee, 22 miles southwest of Stuart, and 36 miles northwest of West Palm Beach. It covers about 14.4 square miles, including a small share of water, and sits about 36 feet above sea level. The St. Lucie Canal is the southern border and links Lake Okeechobee to the St. Lucie River near Stuart.",
        ],
      },
      {
        title: "How the village is run",
        body: [
          "Residents voted to incorporate in 2017. The measure passed with about 63 percent support after the Florida Legislature authorized a village government. Indiantown uses a council–manager form: five council members set policy, and a manager handles daily operations. The first permanent village manager started on December 17, 2018.",
        ],
      },
      {
        title: "Parks and getting around",
        body: [
          "Payson Park is one of the country’s well-known thoroughbred training centers. Trainers such as William Mott, Christophe Clement, and Shug McGaughey have wintered horses here. Davy Jones of The Monkees also kept horses in Indiantown and died here in 2012.",
          "Village parks include Booker Park, Big Mound Park, Post Family Park, and Timer Powers Park. Martin County Public Transit (MARTY) runs a bus through town.",
        ],
      },
      {
        title: "People from Indiantown",
        body: [
          "NFL players Charles Emanuel, Cleveland Gary, and Corey McIntyre are from Indiantown. Patrick Sheltra won the 2010 ARCA Racing Series championship. Musician and actor Davy Jones lived here later in life.",
          "Browse homes on Zillow, then post a listing, add a company, or share a short town note. Contact details stay hidden until someone asks to see them.",
        ],
      },
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
    navHomes: "Casas",
    navBoard: "Anuncios",
    navDirectory: "Negocios",
    navNews: "Noticias",
    navChat: "Chat",
    navResources: "Ayuda",
    navAbout: "Acerca",
    post: "Publicar",
    menu: "Menú",
    search: "Buscar",
    langLabel: "Idioma",
    searchLabel: "Buscar en Indiantown",
    searchPh: "Buscar…",
    tabListing: "Anuncio",
    tabBusiness: "Negocio",
    tabNews: "Noticia",
    tabRoom: "Sala",
    footer: "Villa de Indiantown, Florida · 34956",
    heroKicker: "Treasure Coast · 34956",
    heroTitle: "Encuentre su lugar en Indiantown",
    heroLede: "Casas en Zillow, anuncios de vecinos y ayuda local en un solo tablón.",
    actionHomes: "Ver casas",
    actionHomesHint: "Listados recientes de Zillow en 34956",
    homesTitle: "Casas en venta",
    homesIntro: "Listados recientes de Indiantown en Zillow. Abra una tarjeta para fotos, precio y el anuncio en vivo.",
    homesNote: "El precio y la disponibilidad están en Zillow y pueden cambiar. Este tablón no vende estas casas.",
    zillowAll: "Ver todo en Zillow",
    zillowNewest: "Más nuevas",
    zillowRent: "En renta",
    zillowSold: "Vendidas",
    zillowNew: "Obra nueva",
    viewOnZillow: "Ver en Zillow",
    localHousing: "Vivienda de vecinos",
    bedsBaths: "hab",
    bathsShort: "baños",
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
    readStory: "Leer nota",
    addCompany: "Agregar su empresa",
    all: "Todo",
    results: "Resultados",
    empty: "Nada coincide. Pruebe otra palabra o publíquelo usted.",
    emptyRooms: "Aún no hay salas. Pida una y un administrador la revisará.",
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
    aboutMotto: "Where Great Things Grow",
    aboutWiki: "La historia y las cifras se adaptan de Wikipedia y del censo de EE. UU.",
    aboutWikiLink: "Wikipedia: Indiantown, Florida",
    aboutFacts: [
      { label: "Población (2020)", value: "6,560" },
      { label: "Tierra", value: "14.2 mi²" },
      { label: "Asentado", value: "1890s" },
      { label: "Incorporado", value: "31 dic. 2017" },
      { label: "Elevación", value: "36 pies" },
      { label: "ZIP / área", value: "34956 · 772" },
      { label: "Gobierno", value: "Concejo y gerente" },
      { label: "Huso horario", value: "Este" },
    ],
    aboutSections: [
      {
        title: "El pueblo",
        body: [
          "Indiantown es un pueblo en el oeste del condado de Martin, en el interior de la Treasure Coast de la Florida. En el censo de 2020 vivían unas 6,560 personas. La edad mediana era 30 años. Es una comunidad rural fundada a principios del siglo XX e incorporada el 31 de diciembre de 2017.",
          "Un alcalde y un concejo de cinco miembros se eligen en todo el pueblo. Un administrador dirige el día a día. El lema es “Where Great Things Grow.” La alcaldía está en 15516 SW Osceola St., Suite B. Los trámites oficiales siguen en indiantownfl.gov.",
        ],
      },
      {
        title: "Historia",
        body: [
          "El pueblo seminole usó primero este terreno más alto como puesto de trueque después de la Primera Guerra Seminole, con caza y pesca cerca. Colonos estadounidenses blancos llegaron en la década de 1890.",
          "En 1924 S. Davies Warfield extendió el ferrocarril Seaboard Air Line desde Coleman hasta West Palm Beach, con parada en Indiantown, y planeó una ciudad modelo. Warfield Boulevard y Warfield Elementary aún llevan su nombre. Construyó viviendas, una escuela, una estación y el Seminole Inn, hoy en el Registro Nacional de Lugares Históricos. Quería que Indiantown fuera el hub sur del ferrocarril.",
          "El auge de tierras de los años 20 se apagó después de 1926, Warfield murió en 1927 y el huracán de Okeechobee de 1928 detuvo el crecimiento. En 1952 la Indiantown Company retomó el desarrollo y añadió agua y alcantarillado, viviendas, muelles en el río St. Lucie y una pista de 6,000 pies para carga pequeña y vuelos civiles.",
          "En los años 50 y 60 el Circle T Ranch y el Rodeo Bowl atrajeron grandes multitudes: unos 15,000 visitantes en 1963, entonces una de las atracciones más grandes de la Florida. Luego vendieron el rancho y lo usaron como estudio de cine. Los trenes de pasajeros de Seaboard pararon aquí hasta los años 60. Amtrak terminó ese servicio en 1971 y luego demolieron la estación. El Seminole Inn es el edificio principal que queda del auge de los años 20.",
        ],
      },
      {
        title: "Gente y trabajo",
        body: [
          "Desde los años 80, familias mayas de Guatemala se establecieron aquí al huir de la guerra civil y el genocidio. Hacia 2010, varios miles de mayas vivían en Indiantown y alrededores. Muchos hablaban primero una lengua maya. Algunos dijeron que el nombre “Indiantown” atrajo a familias indígenas.",
          "El censo pasó de 5,588 en 2000 a 6,083 en 2010 y 6,560 en 2020. En 2020 cerca del 70 por ciento se identificó como hispano o latino, el 17 por ciento como blanco (no hispano) y el 12 por ciento como negro. Un 32 por ciento tenía menos de 18 años. Había 1,777 hogares y el 46 por ciento tenía niños en casa.",
          "La agricultura de temporada sigue sosteniendo la economía. El pueblo también está cerca de carreteras importantes y funciona como un pequeño hub de transporte. La gente aún habla de revivir el rodeo y de mostrar los humedales cercanos a los visitantes.",
        ],
      },
      {
        title: "Lugar",
        body: [
          "Indiantown está a 12 millas al este de Port Mayaca, en el lago Okeechobee; a 22 millas al suroeste de Stuart; y a 36 millas al noroeste de West Palm Beach. Cubre unas 14.4 millas cuadradas, con una parte pequeña de agua, y está a unos 36 pies sobre el nivel del mar. El canal St. Lucie es el límite sur y une el lago Okeechobee con el río St. Lucie cerca de Stuart.",
        ],
      },
      {
        title: "Cómo se gobierna",
        body: [
          "Los residentes votaron incorporar el pueblo en 2017. La medida pasó con cerca del 63 por ciento después de que la Legislatura de la Florida autorizara un gobierno municipal. Indiantown usa el modelo concejo–gerente: cinco concejales fijan la política y un gerente dirige las operaciones. El primer gerente permanente empezó el 17 de diciembre de 2018.",
        ],
      },
      {
        title: "Parques y transporte",
        body: [
          "Payson Park es uno de los centros de entrenamiento de caballos de carrera más conocidos del país. Entrenadores como William Mott, Christophe Clement y Shug McGaughey han invernado caballos aquí. Davy Jones de The Monkees también tuvo caballos en Indiantown y murió aquí en 2012.",
          "Los parques del pueblo incluyen Booker Park, Big Mound Park, Post Family Park y Timer Powers Park. Martin County Public Transit (MARTY) tiene autobús por el pueblo.",
        ],
      },
      {
        title: "Gente de Indiantown",
        body: [
          "Los jugadores de la NFL Charles Emanuel, Cleveland Gary y Corey McIntyre son de Indiantown. Patrick Sheltra ganó el campeonato ARCA Racing Series de 2010. El músico y actor Davy Jones vivió aquí en sus últimos años.",
          "Vea casas en Zillow, publique un anuncio, agregue una empresa o comparta una nota. Los datos de contacto se ocultan hasta que alguien pida verlos.",
        ],
      },
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
  $$("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria;
    if (t()[key]) el.setAttribute("aria-label", t()[key]);
  });
  $$("[data-lang-set]").forEach((btn) => {
    const on = btn.dataset.langSet === state.lang;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
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
  return `<button class="card" data-open="news" data-id="${row.id}">
    <span class="tag">${escapeHtml(row.author)}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <span class="blurb">${escapeHtml(excerpt(row.body, 140))}</span>
    <span class="meta">${t().readStory}</span>
  </button>`;
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

function zillowCard(row) {
  const facts = [
    row.beds != null ? `${row.beds} ${t().bedsBaths}` : "",
    row.baths != null ? `${row.baths} ${t().bathsShort}` : "",
    row.sqft ? `${row.sqft.toLocaleString(state.lang === "es" ? "es-US" : "en-US")} sqft` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<a class="card home-card" href="${escapeAttr(row.url)}" target="_blank" rel="noopener">
    <span class="tag">${escapeHtml(row.kind || "Zillow")}</span>
    <strong>${row.price != null ? money(row.price * 100) : t().viewOnZillow}</strong>
    <span class="blurb">${escapeHtml(row.address)}</span>
    <span class="meta">${escapeHtml(facts)}</span>
    <span class="meta">${t().viewOnZillow}</span>
  </a>`;
}

function zillowLinks(links) {
  return `<p class="zillow-links">
    <a class="primary" href="${escapeAttr(links.sale)}" target="_blank" rel="noopener">${t().zillowAll}</a>
    <a href="${escapeAttr(links.newest)}" target="_blank" rel="noopener">${t().zillowNewest}</a>
    <a href="${escapeAttr(links.newHomes)}" target="_blank" rel="noopener">${t().zillowNew}</a>
    <a href="${escapeAttr(links.rent)}" target="_blank" rel="noopener">${t().zillowRent}</a>
    <a href="${escapeAttr(links.sold)}" target="_blank" rel="noopener">${t().zillowSold}</a>
  </p>`;
}

async function renderHomes() {
  const data = await api("/api/homes");
  return `<p class="kicker">Zillow · 34956</p>
    <h1>${t().homesTitle}</h1>
    <p class="lede">${t().homesIntro}</p>
    ${zillowLinks(data.links)}
    <div class="grid home-grid">${data.recent.map(zillowCard).join("")}</div>
    <p class="muted homes-note">${t().homesNote}</p>
    <div class="toolbar"><h2>${t().localHousing}</h2><a href="#/board" data-link>${t().seeBoard}</a></div>
    ${gridOrEmpty((data.local || []).map(listingCard).join(""))}`;
}

async function renderHome() {
  const [counts, listings, news, homes] = await Promise.all([
    api("/api/stats"),
    api("/api/listings"),
    api("/api/news"),
    api("/api/homes"),
  ]);
  return `<section class="hero hero-banner">
    <div>
      <p class="kicker">${t().heroKicker}</p>
      <h1>${t().heroTitle}</h1>
      <p class="lede">${t().heroLede}</p>
      <p class="hero-actions">
        <a class="primary" href="#/homes" data-link>${t().actionHomes}</a>
        <button class="ghost" type="button" data-open-post data-tab="listing">${t().actionListing}</button>
      </p>
    </div>
    <p class="statline">
      <span><b>${homes.recent?.length || 0}</b> ${t().navHomes}</span>
      <span><b>${counts.listings}</b> ${t().listings}</span>
      <span><b>${counts.businesses}</b> ${t().businesses}</span>
      <span><b>${counts.news}</b> ${t().news}</span>
      <span><b>${counts.resources}</b> ${t().resources}</span>
    </p>
  </section>
  <section class="homes-strip">
    <div class="toolbar"><h2>${t().homesTitle}</h2><a href="#/homes" data-link>${t().seeBoard}</a></div>
    <p class="muted">${t().actionHomesHint}</p>
    <div class="grid home-grid">${homes.recent.slice(0, 4).map(zillowCard).join("")}</div>
    ${zillowLinks(homes.links)}
  </section>
  <div class="actions">
    <a class="action" href="#/homes" data-link><strong>${t().actionHomes}</strong><span>${t().actionHomesHint}</span></a>
    <button class="action" type="button" data-open-post data-tab="listing"><strong>${t().actionListing}</strong><span>${t().actionListingHint}</span></button>
    <button class="action" type="button" data-open-post data-tab="business"><strong>${t().actionBiz}</strong><span>${t().actionBizHint}</span></button>
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

function formatDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(state.lang === "es" ? "es-US" : "en-US", {
    dateStyle: "medium",
  }).format(date);
}

async function renderNewsStory(id) {
  const row = await api(`/api/news/${id}`);
  const when = formatDay(row.created_at);
  return `<p><a href="#/news" data-link>${t().back}</a></p>
    <article class="detail">
      <span class="tag">${escapeHtml(row.author)}</span>
      <h1>${escapeHtml(row.title)}</h1>
      ${when ? `<p class="muted">${escapeHtml(when)}</p>` : ""}
      <div class="prose">${String(row.body || "")
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("")}</div>
    </article>`;
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
  const facts = t()
    .aboutFacts.map((row) => `<div class="fact"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`)
    .join("");
  const sections = t()
    .aboutSections.map(
      (section) =>
        `<h2>${escapeHtml(section.title)}</h2>${section.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}`,
    )
    .join("");
  return `<p class="kicker">34956 · ${escapeHtml(t().aboutMotto)}</p>
    <img class="about-seal" src="/village-seal.png" width="160" height="160" alt="Village of Indiantown, Florida official seal" />
    <h1>${t().aboutTitle}</h1>
    <div class="facts">${facts}</div>
    <div class="prose about-prose">${sections}
    <p class="note">Village of Indiantown · <a href="https://www.indiantownfl.gov/" target="_blank" rel="noopener">indiantownfl.gov</a> · (772) 597-9900</p>
    <p class="muted">${escapeHtml(t().aboutWiki)} <a href="https://en.wikipedia.org/wiki/Indiantown,_Florida" target="_blank" rel="noopener">${escapeHtml(t().aboutWikiLink)}</a></p>
    </div>`;
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
    ${rows.length ? `<div class="grid">${rows.map(roomCard).join("")}</div>` : `<p class="empty">${t().emptyRooms}</p>`}`;
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
  homes: renderHomes,
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
    } else if (page === "news" && id) {
      main.innerHTML = await renderNewsStory(id);
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
  const lang = event.target.closest("[data-lang-set]");
  if (lang) {
    state.lang = lang.dataset.langSet === "es" ? "es" : "en";
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
