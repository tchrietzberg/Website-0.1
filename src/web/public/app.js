import { parseHash } from "./routes.js";

const copy = {
  en: {
    brand: "Indiantown Board",
    navHome: "Home",
    navHomes: "Homes",
    navBoard: "Listings",
    navDirectory: "Businesses",
    navNews: "News",
    navEvents: "Events",
    navFacebook: "Facebook",
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
    tabEvent: "Event",
    tabRoom: "Chat room",
    footer: "Village of Indiantown, Florida · 34956",
    heroKicker: "Treasure Coast · 34956",
    heroTitle: "Find your place in Indiantown",
    heroLede: "Neighbor listings first — plus local help and homes on Zillow.",
    actionBoard: "See listings",
    actionBoardHint: "For sale, jobs, housing, and help from neighbors",
    actionHomes: "Browse homes",
    actionHomesHint: "Recent Zillow listings in 34956",
    homesTitle: "Homes for sale",
    homesIntro: "Recent Indiantown listings on Zillow. Open a card for photos, price, and the live listing.",
    homesNote: "Photos, price, and availability are on Zillow and can change. This board does not sell these homes.",
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
    latestJobs: "Jobs",
    latestEvents: "Upcoming events",
    eventsTitle: "Events",
    eventsIntro: "Official Village, Chamber, and library dates, plus neighbor events after review.",
    eventsOfficial: "Official calendars",
    eventsCommunity: "Neighbor events",
    eventsNote: "Agendas and tickets stay on each official site. Neighbor events wait for admin review.",
    addEvent: "Add an event",
    openCalendar: "Open calendar",
    stormTitle: "Storms and the canal",
    stormIntro: "Official weather, county emergency, and St. Lucie Canal links. Call 911 if someone is in danger.",
    jobsIntro: "Grove, weekend, and local help wanted from neighbors.",
    seeJobs: "See jobs",
    seeEvents: "See events",
    postedPending: "Sent. An admin will review it before it is public.",
    hidden: "Hidden",
    hidePost: "Hide",
    reviewListings: "Listings to review",
    reviewNews: "News to review",
    reviewEvents: "Events to review",
    aboutMapTitle: "Village map",
    aboutMapIntro: "Directions sit with each historic photo and About note.",
    aboutMapNote: "Google Maps opens driving directions for that place. Hours stay with each site.",
    openMap: "Get directions",
    photoTooBig: "Photo must be a JPEG or PNG under 700 KB.",
    aboutMapPlaces: [
      {
        title: "Village Hall",
        blurb: "15516 SW Osceola St., Suite B",
        dest: "15516 SW Osceola St, Indiantown, FL 34956",
        topic: "government",
      },
      {
        title: "Elisabeth Lahti Library",
        blurb: "15200 E. Thelma Waters Ave",
        dest: "Elisabeth Lahti Library, 15200 E Thelma Waters Ave, Indiantown, FL 34956",
        topic: "village",
      },
      {
        title: "Booker Park",
        blurb: "15101 SW 169th Ave",
        dest: "Booker Park, 15101 SW 169th Ave, Indiantown, FL 34956",
        topic: "parks",
      },
    ],
    facebookTitle: "Official Facebook",
    facebookIntro: "The latest public post from each official Village, Chamber, Library, County, and Sheriff page. Village business still stays on indiantownfl.gov.",
    facebookLatest: "Latest posts",
    facebookNote: "Timelines use Facebook’s official page embed. This board does not copy or scrape posts.",
    facebookPages: "Official pages",
    openFacebook: "Open on Facebook",
    officialSite: "Official site",
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
    resourceIntro: "Official Village, county, and local contacts in English and Spanish. Storm, canal, and 911 links are at the top. Call 911 if someone is in danger.",
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
    aboutPlacesTitle: "Historic places",
    aboutPlacesIntro: "The 1920s boom, the canal, and ranch country still shape the village.",
    aboutPlacesNote: "Each place has the story and Google driving directions. Hours stay with each site.",
    aboutClick: "Open a place for the full note, or tap Get directions for the drive.",
    aboutStoriesTitle: "Village stories",
    aboutSources: "Sources",
    aboutMissing: "That About note is not here.",
    readMore: "Read more",
    aboutFeatured: {
      id: "seminole-inn",
      photo: "/about/seminole-inn.jpg",
      title: "Seminole Inn",
      era: "1920s · National Register",
      caption: "The main building left from S. Davies Warfield’s model city — still the village’s landmark inn.",
      dest: "Seminole Inn, 15885 SW Warfield Blvd, Indiantown, FL 34956",
      body: [
        "S. Davies Warfield built the Seminole Inn in the 1920s as part of a planned model city around the Seaboard Air Line Railroad stop.",
        "The Florida land boom faded after 1926, Warfield died in 1927, and the 1928 Okeechobee hurricane stopped further growth. The inn is the main building left from that boom and is on the National Register of Historic Places.",
        "It still stands as the village landmark on the main route through town.",
      ],
      links: [
        { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        { label: "Village of Indiantown", href: "https://www.indiantownfl.gov/" },
      ],
    },
    aboutPlaces: [
      {
        id: "warfield-blvd",
        photo: "/about/warfield-blvd.jpg",
        title: "Warfield Boulevard",
        era: "1924",
        caption: "The main route through town, named for the railroad builder who planned a model city here.",
        dest: "Warfield Boulevard, Indiantown, FL 34956",
        body: [
          "In 1924 S. Davies Warfield extended the Seaboard Air Line Railroad from Coleman to West Palm Beach, with a stop in Indiantown.",
          "He planned streets, housing, a school, a depot, and the Seminole Inn. Warfield Boulevard and Warfield Elementary still carry his name.",
          "He hoped Indiantown would become the railroad’s southern hub. After he died in 1927, that plan ended, but the boulevard is still the main street.",
        ],
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "Seaboard Air Line Railroad", href: "https://en.wikipedia.org/wiki/Seaboard_Air_Line_Railroad" },
        ],
      },
      {
        id: "st-lucie-canal",
        photo: "/about/st-lucie-canal.jpg",
        title: "St. Lucie Canal",
        era: "Southern border",
        caption: "Links Lake Okeechobee to the St. Lucie River near Stuart and still frames the village edge.",
        dest: "St. Lucie Canal, Indiantown, FL 34956",
        body: [
          "The St. Lucie Canal is the village’s southern border. It is part of the Okeechobee Waterway.",
          "The canal links Lake Okeechobee to the St. Lucie River near Stuart, about 22 miles northeast of town.",
          "Indiantown sits 12 miles east of Port Mayaca on the lake and about 36 feet above sea level.",
        ],
        links: [
          { label: "Wikipedia: St. Lucie Canal", href: "https://en.wikipedia.org/wiki/St._Lucie_Canal" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
      },
      {
        id: "seaboard-rail",
        photo: "/about/seaboard-rail.jpg",
        title: "Seaboard railroad",
        era: "1924–1971",
        caption: "Passenger trains stopped here into the 1960s. The depot is gone; the rails still mark the boom years.",
        dest: "Seaboard railroad, Indiantown, FL 34956",
        body: [
          "Warfield’s 1924 Seaboard extension put Indiantown on the map. Passenger trains stopped here into the 1960s.",
          "Amtrak ended that service in 1971. The depot was demolished a few years later.",
          "The Seminole Inn is the main building left from the railroad boom.",
        ],
        links: [
          { label: "Seaboard Air Line Railroad", href: "https://en.wikipedia.org/wiki/Seaboard_Air_Line_Railroad" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
      },
      {
        id: "circle-t",
        photo: "/about/circle-t-rodeo.jpg",
        title: "Circle T Rodeo Bowl",
        era: "1950s–1960s",
        caption: "About 15,000 people came in 1963, then one of Florida’s largest attractions.",
        dest: "Circle T Ranch, Indiantown, FL 34956",
        body: [
          "In the 1950s and 1960s Indiantown was home to the Circle T Ranch and its Rodeo Bowl.",
          "The 1963 rodeo drew about 15,000 visitors — then one of Florida’s largest attractions.",
          "The ranch was later sold and used as a filming studio. Neighbors still talk about bringing the rodeo back.",
        ],
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
      },
      {
        id: "payson-park",
        photo: "/about/payson-park.jpg",
        title: "Payson Park",
        era: "Thoroughbreds",
        caption: "A well-known winter training ground. Davy Jones of The Monkees kept horses here.",
        dest: "Payson Park Thoroughbred Training Center, Indiantown, FL 34956",
        body: [
          "Payson Park is one of the country’s well-known thoroughbred training centers.",
          "Trainers such as William Mott, Christophe Clement, and Shug McGaughey have wintered horses here.",
          "Davy Jones of The Monkees kept horses in Indiantown and died here in 2012.",
        ],
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "Village parks", href: "https://www.indiantownfl.gov/" },
        ],
      },
    ],
    aboutFacts: [
      { label: "Population (2020)", value: "6,560", topic: "people" },
      { label: "Land", value: "14.2 sq mi", topic: "place" },
      { label: "Settled", value: "1890s", topic: "history" },
      { label: "Incorporated", value: "Dec. 31, 2017", topic: "government" },
      { label: "Elevation", value: "36 ft", topic: "place" },
      { label: "ZIP / area", value: "34956 · 772", topic: "village" },
      { label: "Government", value: "Council–manager", topic: "government" },
      { label: "Time zone", value: "Eastern", topic: "village" },
    ],
    aboutSections: [
      {
        id: "village",
        title: "The village",
        dest: "15516 SW Osceola St, Indiantown, FL 34956",
        links: [
          { label: "Village of Indiantown", href: "https://www.indiantownfl.gov/" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
        body: [
          "Indiantown is a village in western Martin County, in the interior of Florida’s Treasure Coast. About 6,560 people lived here at the 2020 census. The median age was 30. It is a rural community first established in the early 1900s and incorporated on December 31, 2017.",
          "A mayor and a five-member council are elected at-large. A village manager runs day-to-day work. The village motto is “Where Great Things Grow.” Village Hall is at 15516 SW Osceola St., Suite B. Official business stays on indiantownfl.gov.",
        ],
      },
      {
        id: "history",
        title: "History",
        dest: "Seminole Inn, 15885 SW Warfield Blvd, Indiantown, FL 34956",
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "1928 Okeechobee hurricane", href: "https://en.wikipedia.org/wiki/1928_Okeechobee_hurricane" },
        ],
        body: [
          "Seminole people first used this higher ground as a trading post after the First Seminole War, with hunting and fishing nearby. White American settlers arrived in the 1890s.",
          "In 1924 S. Davies Warfield extended the Seaboard Air Line Railroad from Coleman to West Palm Beach, with a stop in Indiantown, and planned a model city. Warfield Boulevard and Warfield Elementary still carry his name. He built housing, a school, a depot, and the Seminole Inn, now on the National Register of Historic Places. He hoped Indiantown would become the railroad’s southern hub.",
          "The 1920s Florida land boom faded after 1926, Warfield died in 1927, and the 1928 Okeechobee hurricane stopped further growth. In 1952 the Indiantown Company took over local development and added water and sewer, housing, docks on the St. Lucie River, and a 6,000-foot airstrip for small cargo and civilian flights.",
          "In the 1950s and 1960s the Circle T Ranch and Rodeo Bowl drew huge crowds — about 15,000 people in 1963, then one of Florida’s largest attractions. The ranch was later sold and used as a filming studio. Seaboard passenger trains stopped here into the 1960s. Amtrak ended that service in 1971, and the depot was later demolished. The Seminole Inn is the main building left from the 1920s boom.",
        ],
      },
      {
        id: "people",
        title: "People and work",
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "U.S. Census", href: "https://data.census.gov/" },
        ],
        body: [
          "From the 1980s, Maya families from Guatemala settled here while fleeing civil war and genocide. By around 2010, several thousand Maya lived in and around Indiantown. Many spoke a Mayan language first. Some said the name “Indiantown” itself drew Indigenous families here.",
          "The census count grew from 5,588 in 2000 to 6,083 in 2010 and 6,560 in 2020. In 2020 about 70 percent of residents identified as Hispanic or Latino, 17 percent as White (not Hispanic), and 12 percent as Black. About 32 percent were under 18. There were 1,777 households, and 46 percent of them had children at home.",
          "Seasonal agriculture still anchors the local economy. The village also sits near major roads and works as a small transport hub. Neighbors still talk about bringing the rodeo back and pointing visitors to nearby wetlands.",
        ],
      },
      {
        id: "place",
        title: "Place",
        dest: "St. Lucie Canal, Indiantown, FL 34956",
        links: [
          { label: "Wikipedia: St. Lucie Canal", href: "https://en.wikipedia.org/wiki/St._Lucie_Canal" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
        body: [
          "Indiantown is 12 miles east of Port Mayaca on Lake Okeechobee, 22 miles southwest of Stuart, and 36 miles northwest of West Palm Beach. It covers about 14.4 square miles, including a small share of water, and sits about 36 feet above sea level. The St. Lucie Canal is the southern border and links Lake Okeechobee to the St. Lucie River near Stuart.",
        ],
      },
      {
        id: "government",
        title: "How the village is run",
        dest: "15516 SW Osceola St, Indiantown, FL 34956",
        links: [
          { label: "Village of Indiantown", href: "https://www.indiantownfl.gov/" },
          { label: "Village Hall", href: "https://www.indiantownfl.gov/" },
        ],
        body: [
          "Residents voted to incorporate in 2017. The measure passed with about 63 percent support after the Florida Legislature authorized a village government. Indiantown uses a council–manager form: five council members set policy, and a manager handles daily operations. The first permanent village manager started on December 17, 2018.",
        ],
      },
      {
        id: "parks",
        title: "Parks and getting around",
        dest: "Booker Park, 15101 SW 169th Ave, Indiantown, FL 34956",
        links: [
          { label: "Village of Indiantown", href: "https://www.indiantownfl.gov/" },
          { label: "Martin County (MARTY)", href: "https://www.martin.fl.us/" },
        ],
        body: [
          "Payson Park is one of the country’s well-known thoroughbred training centers. Trainers such as William Mott, Christophe Clement, and Shug McGaughey have wintered horses here. Davy Jones of The Monkees also kept horses in Indiantown and died here in 2012.",
          "Village parks include Booker Park, Big Mound Park, Post Family Park, and Timer Powers Park. Martin County Public Transit (MARTY) runs a bus through town.",
        ],
      },
      {
        id: "notable",
        title: "People from Indiantown",
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
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
      submitEvent: "Request event",
      submitRoom: "Request room",
      topic: "Topic",
      host: "Your name",
      photo: "Photo (optional)",
      place: "Place",
      startsOn: "Date",
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
    navEvents: "Eventos",
    navFacebook: "Facebook",
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
    tabEvent: "Evento",
    tabRoom: "Sala",
    footer: "Villa de Indiantown, Florida · 34956",
    heroKicker: "Treasure Coast · 34956",
    heroTitle: "Encuentre su lugar en Indiantown",
    heroLede: "Primero los anuncios de vecinos — más ayuda local y casas en Zillow.",
    actionBoard: "Ver anuncios",
    actionBoardHint: "Ventas, empleos, vivienda y ayuda de vecinos",
    actionHomes: "Ver casas",
    actionHomesHint: "Listados recientes de Zillow en 34956",
    homesTitle: "Casas en venta",
    homesIntro: "Listados recientes de Indiantown en Zillow. Abra una tarjeta para fotos, precio y el anuncio en vivo.",
    homesNote: "Las fotos, el precio y la disponibilidad están en Zillow y pueden cambiar. Este tablón no vende estas casas.",
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
    latestJobs: "Empleos",
    latestEvents: "Próximos eventos",
    eventsTitle: "Eventos",
    eventsIntro: "Fechas oficiales de la Villa, la Cámara y la biblioteca, más eventos de vecinos después de la revisión.",
    eventsOfficial: "Calendarios oficiales",
    eventsCommunity: "Eventos de vecinos",
    eventsNote: "Las agendas y los boletos quedan en cada sitio oficial. Los eventos de vecinos esperan revisión.",
    addEvent: "Agregar un evento",
    openCalendar: "Abrir calendario",
    stormTitle: "Tormentas y el canal",
    stormIntro: "Clima oficial, emergencias del condado y el canal St. Lucie. Llame al 911 si alguien está en peligro.",
    jobsIntro: "Trabajo en los huertos, fines de semana y ayuda local de vecinos.",
    seeJobs: "Ver empleos",
    seeEvents: "Ver eventos",
    postedPending: "Enviado. Un administrador lo revisará antes de que sea público.",
    hidden: "Oculto",
    hidePost: "Ocultar",
    reviewListings: "Anuncios por revisar",
    reviewNews: "Noticias por revisar",
    reviewEvents: "Eventos por revisar",
    aboutMapTitle: "Mapa del pueblo",
    aboutMapIntro: "Las rutas van con cada foto histórica y cada nota.",
    aboutMapNote: "Google Maps abre la ruta en auto. Los horarios quedan en cada sitio.",
    openMap: "Cómo llegar",
    photoTooBig: "La foto debe ser JPEG o PNG de menos de 700 KB.",
    aboutMapPlaces: [
      {
        title: "Alcaldía",
        blurb: "15516 SW Osceola St., Suite B",
        dest: "15516 SW Osceola St, Indiantown, FL 34956",
        topic: "government",
      },
      {
        title: "Biblioteca Elisabeth Lahti",
        blurb: "15200 E. Thelma Waters Ave",
        dest: "Elisabeth Lahti Library, 15200 E Thelma Waters Ave, Indiantown, FL 34956",
        topic: "village",
      },
      {
        title: "Booker Park",
        blurb: "15101 SW 169th Ave",
        dest: "Booker Park, 15101 SW 169th Ave, Indiantown, FL 34956",
        topic: "parks",
      },
    ],
    facebookTitle: "Facebook oficial",
    facebookIntro: "La publicación pública más reciente de cada página oficial del Pueblo, la Cámara, la biblioteca, el condado y el Sheriff. Los trámites del pueblo siguen en indiantownfl.gov.",
    facebookLatest: "Publicaciones recientes",
    facebookNote: "Las líneas de tiempo usan el embed oficial de Facebook. Este tablón no copia ni extrae publicaciones.",
    facebookPages: "Páginas oficiales",
    openFacebook: "Abrir en Facebook",
    officialSite: "Sitio oficial",
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
    resourceIntro: "Contactos oficiales del pueblo, el condado y la zona en inglés y español. Arriba están tormenta, canal y 911. Llame al 911 si hay peligro.",
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
    aboutPlacesTitle: "Lugares históricos",
    aboutPlacesIntro: "El auge de los años 20, el canal y el campo ganadero aún marcan el pueblo.",
    aboutPlacesNote: "Cada lugar tiene la nota y la ruta en Google Maps. Los horarios quedan en cada sitio.",
    aboutClick: "Abra un lugar para la nota completa, o toque Cómo llegar para la ruta.",
    aboutStoriesTitle: "Historias del pueblo",
    aboutSources: "Fuentes",
    aboutMissing: "Esa nota no está aquí.",
    readMore: "Leer más",
    aboutFeatured: {
      id: "seminole-inn",
      photo: "/about/seminole-inn.jpg",
      title: "Seminole Inn",
      era: "Años 20 · Registro Nacional",
      caption: "El edificio principal que queda de la ciudad modelo de S. Davies Warfield — aún el mesón emblemático.",
      dest: "Seminole Inn, 15885 SW Warfield Blvd, Indiantown, FL 34956",
      body: [
        "S. Davies Warfield construyó el Seminole Inn en los años 20 como parte de una ciudad modelo junto a la parada del ferrocarril Seaboard Air Line.",
        "El auge de tierras se apagó después de 1926, Warfield murió en 1927 y el huracán de Okeechobee de 1928 detuvo el crecimiento. El mesón es el edificio principal que queda de ese auge y está en el Registro Nacional de Lugares Históricos.",
        "Sigue en pie como el hito del pueblo en la vía principal.",
      ],
      links: [
        { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        { label: "Villa de Indiantown", href: "https://www.indiantownfl.gov/" },
      ],
    },
    aboutPlaces: [
      {
        id: "warfield-blvd",
        photo: "/about/warfield-blvd.jpg",
        title: "Warfield Boulevard",
        era: "1924",
        caption: "La vía principal del pueblo, en honor al constructor del ferrocarril que planeó una ciudad modelo.",
        dest: "Warfield Boulevard, Indiantown, FL 34956",
        body: [
          "En 1924 S. Davies Warfield extendió el ferrocarril Seaboard Air Line desde Coleman hasta West Palm Beach, con parada en Indiantown.",
          "Planeó calles, viviendas, una escuela, una estación y el Seminole Inn. Warfield Boulevard y Warfield Elementary aún llevan su nombre.",
          "Quería que Indiantown fuera el hub sur del ferrocarril. Tras su muerte en 1927 ese plan terminó, pero el bulevar sigue siendo la calle principal.",
        ],
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "Ferrocarril Seaboard Air Line", href: "https://en.wikipedia.org/wiki/Seaboard_Air_Line_Railroad" },
        ],
      },
      {
        id: "st-lucie-canal",
        photo: "/about/st-lucie-canal.jpg",
        title: "Canal St. Lucie",
        era: "Límite sur",
        caption: "Une el lago Okeechobee con el río St. Lucie cerca de Stuart y sigue marcando el borde del pueblo.",
        dest: "St. Lucie Canal, Indiantown, FL 34956",
        body: [
          "El canal St. Lucie es el límite sur del pueblo. Forma parte de la vía Okeechobee.",
          "Une el lago Okeechobee con el río St. Lucie cerca de Stuart, unas 22 millas al noreste.",
          "Indiantown está a 12 millas al este de Port Mayaca, en el lago, y a unos 36 pies sobre el nivel del mar.",
        ],
        links: [
          { label: "Wikipedia: Canal St. Lucie", href: "https://en.wikipedia.org/wiki/St._Lucie_Canal" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
      },
      {
        id: "seaboard-rail",
        photo: "/about/seaboard-rail.jpg",
        title: "Ferrocarril Seaboard",
        era: "1924–1971",
        caption: "Los trenes de pasajeros pararon aquí hasta los años 60. Ya no está la estación; los rieles recuerdan el auge.",
        dest: "Seaboard railroad, Indiantown, FL 34956",
        body: [
          "La extensión de Seaboard de 1924 puso a Indiantown en el mapa. Los trenes de pasajeros pararon aquí hasta los años 60.",
          "Amtrak terminó ese servicio en 1971. Luego demolieron la estación.",
          "El Seminole Inn es el edificio principal que queda del auge del ferrocarril.",
        ],
        links: [
          { label: "Ferrocarril Seaboard Air Line", href: "https://en.wikipedia.org/wiki/Seaboard_Air_Line_Railroad" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
      },
      {
        id: "circle-t",
        photo: "/about/circle-t-rodeo.jpg",
        title: "Circle T Rodeo Bowl",
        era: "Años 50–60",
        caption: "Unos 15,000 visitantes en 1963, entonces una de las atracciones más grandes de la Florida.",
        dest: "Circle T Ranch, Indiantown, FL 34956",
        body: [
          "En los años 50 y 60 Indiantown tenía el Circle T Ranch y su Rodeo Bowl.",
          "El rodeo de 1963 atrajo unos 15,000 visitantes, entonces una de las atracciones más grandes de la Florida.",
          "Luego vendieron el rancho y lo usaron como estudio de cine. La gente aún habla de revivir el rodeo.",
        ],
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
      },
      {
        id: "payson-park",
        photo: "/about/payson-park.jpg",
        title: "Payson Park",
        era: "Caballos de carrera",
        caption: "Un centro conocido de entrenamiento de invierno. Davy Jones de The Monkees tuvo caballos aquí.",
        dest: "Payson Park Thoroughbred Training Center, Indiantown, FL 34956",
        body: [
          "Payson Park es uno de los centros de entrenamiento de caballos de carrera más conocidos del país.",
          "Entrenadores como William Mott, Christophe Clement y Shug McGaughey han invernado caballos aquí.",
          "Davy Jones de The Monkees tuvo caballos en Indiantown y murió aquí en 2012.",
        ],
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "Parques del pueblo", href: "https://www.indiantownfl.gov/" },
        ],
      },
    ],
    aboutFacts: [
      { label: "Población (2020)", value: "6,560", topic: "people" },
      { label: "Tierra", value: "14.2 mi²", topic: "place" },
      { label: "Asentado", value: "1890s", topic: "history" },
      { label: "Incorporado", value: "31 dic. 2017", topic: "government" },
      { label: "Elevación", value: "36 pies", topic: "place" },
      { label: "ZIP / área", value: "34956 · 772", topic: "village" },
      { label: "Gobierno", value: "Concejo y gerente", topic: "government" },
      { label: "Huso horario", value: "Este", topic: "village" },
    ],
    aboutSections: [
      {
        id: "village",
        title: "El pueblo",
        dest: "15516 SW Osceola St, Indiantown, FL 34956",
        links: [
          { label: "Villa de Indiantown", href: "https://www.indiantownfl.gov/" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
        body: [
          "Indiantown es un pueblo en el oeste del condado de Martin, en el interior de la Treasure Coast de la Florida. En el censo de 2020 vivían unas 6,560 personas. La edad mediana era 30 años. Es una comunidad rural fundada a principios del siglo XX e incorporada el 31 de diciembre de 2017.",
          "Un alcalde y un concejo de cinco miembros se eligen en todo el pueblo. Un administrador dirige el día a día. El lema es “Where Great Things Grow.” La alcaldía está en 15516 SW Osceola St., Suite B. Los trámites oficiales siguen en indiantownfl.gov.",
        ],
      },
      {
        id: "history",
        title: "Historia",
        dest: "Seminole Inn, 15885 SW Warfield Blvd, Indiantown, FL 34956",
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "Huracán de Okeechobee de 1928", href: "https://en.wikipedia.org/wiki/1928_Okeechobee_hurricane" },
        ],
        body: [
          "El pueblo seminole usó primero este terreno más alto como puesto de trueque después de la Primera Guerra Seminole, con caza y pesca cerca. Colonos estadounidenses blancos llegaron en la década de 1890.",
          "En 1924 S. Davies Warfield extendió el ferrocarril Seaboard Air Line desde Coleman hasta West Palm Beach, con parada en Indiantown, y planeó una ciudad modelo. Warfield Boulevard y Warfield Elementary aún llevan su nombre. Construyó viviendas, una escuela, una estación y el Seminole Inn, hoy en el Registro Nacional de Lugares Históricos. Quería que Indiantown fuera el hub sur del ferrocarril.",
          "El auge de tierras de los años 20 se apagó después de 1926, Warfield murió en 1927 y el huracán de Okeechobee de 1928 detuvo el crecimiento. En 1952 la Indiantown Company retomó el desarrollo y añadió agua y alcantarillado, viviendas, muelles en el río St. Lucie y una pista de 6,000 pies para carga pequeña y vuelos civiles.",
          "En los años 50 y 60 el Circle T Ranch y el Rodeo Bowl atrajeron grandes multitudes: unos 15,000 visitantes en 1963, entonces una de las atracciones más grandes de la Florida. Luego vendieron el rancho y lo usaron como estudio de cine. Los trenes de pasajeros de Seaboard pararon aquí hasta los años 60. Amtrak terminó ese servicio en 1971 y luego demolieron la estación. El Seminole Inn es el edificio principal que queda del auge de los años 20.",
        ],
      },
      {
        id: "people",
        title: "Gente y trabajo",
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
          { label: "Censo de EE. UU.", href: "https://data.census.gov/" },
        ],
        body: [
          "Desde los años 80, familias mayas de Guatemala se establecieron aquí al huir de la guerra civil y el genocidio. Hacia 2010, varios miles de mayas vivían en Indiantown y alrededores. Muchos hablaban primero una lengua maya. Algunos dijeron que el nombre “Indiantown” atrajo a familias indígenas.",
          "El censo pasó de 5,588 en 2000 a 6,083 en 2010 y 6,560 en 2020. En 2020 cerca del 70 por ciento se identificó como hispano o latino, el 17 por ciento como blanco (no hispano) y el 12 por ciento como negro. Un 32 por ciento tenía menos de 18 años. Había 1,777 hogares y el 46 por ciento tenía niños en casa.",
          "La agricultura de temporada sigue sosteniendo la economía. El pueblo también está cerca de carreteras importantes y funciona como un pequeño hub de transporte. La gente aún habla de revivir el rodeo y de mostrar los humedales cercanos a los visitantes.",
        ],
      },
      {
        id: "place",
        title: "Lugar",
        dest: "St. Lucie Canal, Indiantown, FL 34956",
        links: [
          { label: "Wikipedia: Canal St. Lucie", href: "https://en.wikipedia.org/wiki/St._Lucie_Canal" },
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
        body: [
          "Indiantown está a 12 millas al este de Port Mayaca, en el lago Okeechobee; a 22 millas al suroeste de Stuart; y a 36 millas al noroeste de West Palm Beach. Cubre unas 14.4 millas cuadradas, con una parte pequeña de agua, y está a unos 36 pies sobre el nivel del mar. El canal St. Lucie es el límite sur y une el lago Okeechobee con el río St. Lucie cerca de Stuart.",
        ],
      },
      {
        id: "government",
        title: "Cómo se gobierna",
        dest: "15516 SW Osceola St, Indiantown, FL 34956",
        links: [
          { label: "Villa de Indiantown", href: "https://www.indiantownfl.gov/" },
          { label: "Alcaldía", href: "https://www.indiantownfl.gov/" },
        ],
        body: [
          "Los residentes votaron incorporar el pueblo en 2017. La medida pasó con cerca del 63 por ciento después de que la Legislatura de la Florida autorizara un gobierno municipal. Indiantown usa el modelo concejo–gerente: cinco concejales fijan la política y un gerente dirige las operaciones. El primer gerente permanente empezó el 17 de diciembre de 2018.",
        ],
      },
      {
        id: "parks",
        title: "Parques y transporte",
        dest: "Booker Park, 15101 SW 169th Ave, Indiantown, FL 34956",
        links: [
          { label: "Villa de Indiantown", href: "https://www.indiantownfl.gov/" },
          { label: "Condado de Martin (MARTY)", href: "https://www.martin.fl.us/" },
        ],
        body: [
          "Payson Park es uno de los centros de entrenamiento de caballos de carrera más conocidos del país. Entrenadores como William Mott, Christophe Clement y Shug McGaughey han invernado caballos aquí. Davy Jones de The Monkees también tuvo caballos en Indiantown y murió aquí en 2012.",
          "Los parques del pueblo incluyen Booker Park, Big Mound Park, Post Family Park y Timer Powers Park. Martin County Public Transit (MARTY) tiene autobús por el pueblo.",
        ],
      },
      {
        id: "notable",
        title: "Gente de Indiantown",
        links: [
          { label: "Wikipedia: Indiantown, Florida", href: "https://en.wikipedia.org/wiki/Indiantown,_Florida" },
        ],
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
      submitEvent: "Pedir evento",
      submitRoom: "Pedir sala",
      topic: "Tema",
      host: "Su nombre",
      photo: "Foto (opcional)",
      place: "Lugar",
      startsOn: "Fecha",
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
  const photo = row.photo
    ? `<img src="${escapeAttr(row.photo)}" alt="" width="960" height="600" loading="lazy" />`
    : "";
  return `<button class="card listing-card" data-open="listing" data-id="${row.id}">
    ${photo}
    <span class="listing-body">
      <span class="tag">${t().listingCats[row.category] || row.category}</span>
      <strong>${escapeHtml(row.title)}</strong>
      <span class="blurb">${escapeHtml(excerpt(row.description))}</span>
      <span class="meta"><b class="price">${money(row.price_cents)}</b> · ${escapeHtml(row.neighborhood)}</span>
    </span>
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
  const title = state.lang === "es" && row.title_es ? row.title_es : row.title;
  const description = state.lang === "es" && row.description_es ? row.description_es : row.description;
  const link = row.url
    ? `<a href="${escapeAttr(row.url)}" target="_blank" rel="noopener">${t().website}</a>`
    : "";
  const phone = row.phone
    ? `<a class="phone-link" href="tel:${escapeAttr(row.phone)}">${escapeHtml(row.phone)}</a>`
    : "";
  return `<article class="card is-static">
    <span class="tag">${t().resCats[row.category] || row.category}</span>
    <strong>${escapeHtml(title)}</strong>
    <p class="blurb">${escapeHtml(description)}</p>
    ${phone}
    <span class="muted">${escapeHtml(row.address || "")}</span>
    ${link}
  </article>`;
}

function stormCard(row) {
  const title = state.lang === "es" ? row.title_es || row.title : row.title;
  const blurb = state.lang === "es" ? row.blurb_es || row.blurb : row.blurb;
  const href = row.href.startsWith("tel:") ? row.href : row.site || row.href;
  const phone = row.phone
    ? `<a class="phone-link" href="tel:${escapeAttr(row.phone)}">${escapeHtml(row.phone)}</a>`
    : "";
  return `<article class="card is-static storm-card">
    <strong>${escapeHtml(title)}</strong>
    <p class="blurb">${escapeHtml(blurb)}</p>
    ${phone}
    <a href="${escapeAttr(href)}" ${href.startsWith("tel:") ? "" : 'target="_blank" rel="noopener"'}>${href.startsWith("tel:") ? t().call : t().officialSite}</a>
  </article>`;
}

function stormStrip(links) {
  return `<section class="storm-strip">
    <div class="toolbar"><h2>${t().stormTitle}</h2><a href="#/resources" data-link>${t().actionHelp}</a></div>
    <p class="muted">${t().stormIntro}</p>
    <div class="grid storm-grid">${links.map(stormCard).join("")}</div>
  </section>`;
}

function officialEventCard(row) {
  const title = state.lang === "es" ? row.title_es || row.title : row.title;
  const when = state.lang === "es" ? row.when_es || row.when : row.when;
  const body = state.lang === "es" ? row.body_es || row.body : row.body;
  return `<article class="card is-static">
    <span class="tag">${escapeHtml(row.source)}</span>
    <strong>${escapeHtml(title)}</strong>
    <p class="blurb">${escapeHtml(when)} · ${escapeHtml(row.place)}</p>
    <p class="muted">${escapeHtml(body)}</p>
    <a href="${escapeAttr(row.href)}" target="_blank" rel="noopener">${t().openCalendar}</a>
  </article>`;
}

function communityEventCard(row) {
  return `<article class="card is-static">
    <span class="tag">${escapeHtml(formatDay(row.starts_on) || row.starts_on)}</span>
    <strong>${escapeHtml(row.title)}</strong>
    <p class="blurb">${escapeHtml(row.place)}</p>
    <p class="muted">${escapeHtml(excerpt(row.body, 140))}</p>
    <span class="meta">${escapeHtml(row.host_name)}</span>
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

function googleDirections(query) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function googleVillageEmbed() {
  const hl = state.lang === "es" ? "es" : "en";
  return `https://www.google.com/maps?q=${encodeURIComponent("Indiantown, FL 34956")}&hl=${hl}&z=14&output=embed`;
}

function googlePlaceEmbed(query) {
  const hl = state.lang === "es" ? "es" : "en";
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&hl=${hl}&z=16&output=embed`;
}

function aboutDirections(dest) {
  if (!dest) return "";
  return `<a class="place-dir" href="${escapeAttr(googleDirections(dest))}" target="_blank" rel="noopener">${escapeHtml(t().openMap)}</a>`;
}

function aboutPlaceMap(dest, title) {
  if (!dest) return "";
  return `<div class="about-topic-map">
    <iframe class="about-map-frame" title="${escapeAttr(title)}" src="${escapeAttr(googlePlaceEmbed(dest))}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    <p class="place-actions">${aboutDirections(dest)}</p>
  </div>`;
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
  const [counts, listings, jobs, news, events, storm, homes, facebook] = await Promise.all([
    api("/api/stats"),
    api("/api/listings"),
    api("/api/listings?category=jobs"),
    api("/api/news"),
    api("/api/events"),
    api("/api/storm"),
    api("/api/homes"),
    api("/api/facebook"),
  ]);
  return `<section class="hero hero-banner">
    <div>
      <p class="kicker">${t().heroKicker}</p>
      <h1>${t().heroTitle}</h1>
      <p class="lede">${t().heroLede}</p>
      <p class="hero-actions">
        <a class="primary" href="#/board" data-link>${t().actionBoard}</a>
        <button class="ghost" type="button" data-open-post data-tab="listing">${t().actionListing}</button>
      </p>
    </div>
    <p class="statline">
      <span><b>${counts.listings}</b> ${t().listings}</span>
      <span><b>${counts.businesses}</b> ${t().businesses}</span>
      <span><b>${counts.news}</b> ${t().news}</span>
      <span><b>${counts.events || 0}</b> ${t().navEvents}</span>
      <span><b>${counts.resources}</b> ${t().resources}</span>
      <span><b>${homes.recent?.length || 0}</b> ${t().navHomes}</span>
    </p>
  </section>
  ${stormStrip(storm.links || [])}
  <section>
    <div class="toolbar"><h2>${t().latestBoard}</h2><a href="#/board" data-link>${t().seeBoard}</a></div>
    ${gridOrEmpty(listings.slice(0, 6).map(listingCard).join(""))}
  </section>
  <section>
    <div class="toolbar"><h2>${t().latestJobs}</h2><a href="#/board" data-link>${t().seeJobs}</a></div>
    <p class="muted">${t().jobsIntro}</p>
    ${gridOrEmpty(jobs.slice(0, 4).map(listingCard).join(""))}
  </section>
  <div class="actions">
    <a class="action" href="#/board" data-link><strong>${t().actionBoard}</strong><span>${t().actionBoardHint}</span></a>
    <button class="action" type="button" data-open-post data-tab="listing"><strong>${t().actionListing}</strong><span>${t().actionListingHint}</span></button>
    <button class="action" type="button" data-open-post data-tab="business"><strong>${t().actionBiz}</strong><span>${t().actionBizHint}</span></button>
  </div>
  <section>
    <div class="toolbar"><h2>${t().latestNews}</h2><a href="#/news" data-link>${t().seeNews}</a></div>
    ${gridOrEmpty(news.slice(0, 3).map(newsCard).join(""))}
  </section>
  <section>
    <div class="toolbar"><h2>${t().latestEvents}</h2><a href="#/events" data-link>${t().seeEvents}</a></div>
    ${gridOrEmpty([...(events.official || []).slice(0, 2).map(officialEventCard), ...(events.community || []).slice(0, 2).map(communityEventCard)].join(""))}
  </section>
  <section class="facebook-strip">
    <div class="toolbar"><h2>${t().facebookTitle}</h2><a href="#/facebook" data-link>${t().seeBoard}</a></div>
    <p class="muted">${t().facebookIntro}</p>
    <div class="grid fb-page-grid">${facebook.pages.map(facebookPageCard).join("")}</div>
  </section>
  <section class="homes-strip">
    <div class="toolbar"><h2>${t().homesTitle}</h2><a href="#/homes" data-link>${t().seeBoard}</a></div>
    <p class="muted">${t().actionHomesHint}</p>
    <div class="grid home-grid">${homes.recent.slice(0, 4).map(zillowCard).join("")}</div>
    ${zillowLinks(homes.links)}
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

async function renderEvents() {
  const data = await api("/api/events");
  return `<p class="kicker">34956</p><h1>${t().eventsTitle}</h1>
    <p class="lede">${t().eventsIntro}</p>
    <p><button type="button" class="primary" data-open-post data-tab="event">${t().addEvent}</button></p>
    <h2>${t().eventsOfficial}</h2>
    ${gridOrEmpty((data.official || []).map(officialEventCard).join(""))}
    <h2>${t().eventsCommunity}</h2>
    ${gridOrEmpty((data.community || []).map(communityEventCard).join(""))}
    <p class="muted">${t().eventsNote}</p>`;
}

function facebookPageCard(row) {
  return `<article class="card is-static fb-page-card">
    <span class="tag">${escapeHtml(row.kind)}</span>
    <strong>${escapeHtml(row.name)}</strong>
    <p class="blurb">${escapeHtml(row.blurb)}</p>
    <p class="meta">
      <a href="${escapeAttr(row.href)}" target="_blank" rel="noopener">${t().openFacebook}</a>
      · <a href="${escapeAttr(row.site)}" target="_blank" rel="noopener">${t().officialSite}</a>
    </p>
  </article>`;
}

function facebookEmbed(row) {
  return `<iframe class="fb-frame" title="${escapeAttr(`${row.name} latest posts`)}" src="${escapeAttr(row.embed)}" width="500" height="600" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; clipboard-write"></iframe>`;
}

function facebookPostCard(row) {
  return `<article class="card is-static fb-post-card">
    <header class="fb-post-head">
      <div>
        <span class="tag">${escapeHtml(row.kind)}</span>
        <strong>${escapeHtml(row.name)}</strong>
        <p class="blurb">${escapeHtml(row.blurb)}</p>
      </div>
      <p class="meta fb-post-links">
        <a href="${escapeAttr(row.href)}" target="_blank" rel="noopener">${t().openFacebook}</a>
        <a href="${escapeAttr(row.site)}" target="_blank" rel="noopener">${t().officialSite}</a>
      </p>
    </header>
    <div class="fb-embed">${facebookEmbed(row)}</div>
  </article>`;
}

async function renderFacebook() {
  const data = await api("/api/facebook");
  const pages = data.pages || [];
  return `<article class="facebook-page">
    <header class="facebook-top">
      <p class="kicker">Facebook · 34956</p>
      <h1>${t().facebookTitle}</h1>
      <p class="lede">${t().facebookIntro}</p>
    </header>
    <h2 class="facebook-latest">${t().facebookLatest}</h2>
    ${pages.length ? `<div class="fb-post-grid">${pages.map(facebookPostCard).join("")}</div>` : `<p class="empty">${t().empty}</p>`}
    <p class="muted facebook-note">${t().facebookNote}</p>
  </article>`;
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
  const [rows, storm] = await Promise.all([api(`/api/resources${q}`), api("/api/storm")]);
  return `<p class="kicker">${t().navResources}</p><h1>${t().resources}</h1>
    <p class="lede">${t().resourceIntro}</p>
    ${stormStrip(storm.links || [])}
    ${chips(t().resCats, state.resourceCategory, "resource")}
    ${gridOrEmpty(rows.map(resourceCard).join(""))}`;
}

function aboutTopics() {
  const copy = t();
  return [
    { ...copy.aboutFeatured, kind: "place" },
    ...copy.aboutPlaces.map((row) => ({ ...row, kind: "place" })),
    ...copy.aboutSections.map((row) => ({ ...row, kind: "section" })),
  ];
}

function findAboutTopic(id) {
  return aboutTopics().find((row) => row.id === id) || null;
}

function aboutSourceLinks(links) {
  if (!links?.length) return "";
  return `<p class="about-sources"><strong>${escapeHtml(t().aboutSources)}</strong>
    ${links
      .map((link) => `<a href="${escapeAttr(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`)
      .join(" · ")}</p>`;
}

function aboutFact(row) {
  const inner = `<span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong>`;
  if (!row.topic) return `<div class="fact">${inner}</div>`;
  return `<a class="fact is-link" href="#/about/${encodeURIComponent(row.topic)}" data-link>${inner}</a>`;
}

function aboutSectionCard(section) {
  const teaser = section.body?.[0] || "";
  return `<article class="about-section-card">
    <a href="#/about/${encodeURIComponent(section.id)}" data-link>
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(excerpt(teaser, 160))}</p>
      <span class="read-more">${escapeHtml(t().readMore)}</span>
    </a>
    ${section.dest ? `<p class="place-actions">${aboutDirections(section.dest)}</p>` : ""}
  </article>`;
}

function civicPlaceCard(row) {
  return `<article class="place is-civic">
    <a class="place-media" href="#/about/${encodeURIComponent(row.topic)}" data-link>
      <span class="place-caption">
        <span class="tag">${escapeHtml(t().openMap)}</span>
        <strong>${escapeHtml(row.title)}</strong>
        <span class="blurb">${escapeHtml(row.blurb)}</span>
        <span class="read-more">${escapeHtml(t().readMore)}</span>
      </span>
    </a>
    <p class="place-actions">${aboutDirections(row.dest)}</p>
  </article>`;
}

function placeCard(row, featured = false) {
  const media = `<a class="place-media" ${row.id ? `href="#/about/${encodeURIComponent(row.id)}" data-link` : ""}>
    <img src="${escapeAttr(row.photo)}" alt="${escapeAttr(row.title)}" width="1280" height="853" loading="${featured ? "eager" : "lazy"}" />
    <span class="place-caption">
      <span class="tag">${escapeHtml(row.era)}</span>
      <strong>${escapeHtml(row.title)}</strong>
      <span class="blurb">${escapeHtml(row.caption)}</span>
      ${row.id ? `<span class="read-more">${escapeHtml(t().readMore)}</span>` : ""}
    </span>
  </a>
  ${row.dest ? `<p class="place-actions">${aboutDirections(row.dest)}</p>` : ""}`;
  return `<article class="place${featured ? " is-featured" : ""}">${media}</article>`;
}

function renderAbout() {
  const facts = t().aboutFacts.map(aboutFact).join("");
  const sections = t().aboutSections.map(aboutSectionCard).join("");
  const places = [
    ...t().aboutPlaces.map((row) => placeCard(row)),
    ...t().aboutMapPlaces.map((row) => civicPlaceCard(row)),
  ].join("");
  return `<article class="about-page">
    <header class="about-top">
      <img class="about-seal" src="/village-seal.png" width="160" height="160" alt="Village of Indiantown, Florida official seal" />
      <p class="kicker">34956 · ${escapeHtml(t().aboutMotto)}</p>
      <h1>${t().aboutTitle}</h1>
      <p class="lede">${escapeHtml(t().aboutClick)}</p>
    </header>
    ${placeCard(t().aboutFeatured, true)}
    <div class="about-body">
      <div class="facts">${facts}</div>
      <section class="about-places">
        <h2>${escapeHtml(t().aboutPlacesTitle)}</h2>
        <p class="lede">${escapeHtml(t().aboutPlacesIntro)}</p>
        <div class="place-gallery">${places}</div>
        <p class="muted">${escapeHtml(t().aboutPlacesNote)}</p>
      </section>
      <section class="about-stories">
        <h2>${escapeHtml(t().aboutStoriesTitle)}</h2>
        <div class="about-section-grid">${sections}</div>
        <p class="note">Village of Indiantown · <a href="https://www.indiantownfl.gov/" target="_blank" rel="noopener">indiantownfl.gov</a> · (772) 597-9900</p>
        <p class="muted">${escapeHtml(t().aboutWiki)} <a href="https://en.wikipedia.org/wiki/Indiantown,_Florida" target="_blank" rel="noopener">${escapeHtml(t().aboutWikiLink)}</a></p>
      </section>
    </div>
  </article>`;
}

function renderAboutTopic(id) {
  const row = findAboutTopic(id);
  if (!row) {
    return `<article class="about-page about-topic-page">
      <div class="about-body">
        <p><a href="#/about" data-link>${t().back}</a></p>
        <h1>${escapeHtml(t().aboutMissing)}</h1>
      </div>
    </article>`;
  }
  const photo = row.photo
    ? `<figure class="place is-featured about-topic-hero">
        <img src="${escapeAttr(row.photo)}" alt="${escapeAttr(row.title)}" width="1280" height="853" />
        <figcaption class="place-caption">
          ${row.era ? `<span class="tag">${escapeHtml(row.era)}</span>` : ""}
          <strong>${escapeHtml(row.title)}</strong>
          ${row.caption ? `<span class="blurb">${escapeHtml(row.caption)}</span>` : ""}
        </figcaption>
      </figure>`
    : "";
  const body = (row.body || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return `<article class="about-page about-topic-page">
    ${photo}
    <div class="about-body">
      <p><a href="#/about" data-link>${t().back}</a></p>
      ${photo ? "" : `<p class="kicker">${escapeHtml(t().aboutTitle)}</p><h1>${escapeHtml(row.title)}</h1>`}
      <div class="prose about-prose">${body}${aboutSourceLinks(row.links)}</div>
      ${aboutPlaceMap(row.dest, row.title)}
    </div>
  </article>`;
}

async function renderSearch() {
  const data = await api(`/api/search?q=${encodeURIComponent(state.query)}`);
  return `<p class="kicker">${t().search}</p><h1>${t().results}</h1>
    <p class="muted">${escapeHtml(state.query)}</p>
    <h2>${t().listings}</h2>${gridOrEmpty(data.listings.map(listingCard).join(""))}
    <h2>${t().businesses}</h2>${gridOrEmpty(data.businesses.map(businessCard).join(""))}
    <h2>${t().news}</h2>${gridOrEmpty(data.news.map(newsCard).join(""))}
    <h2>${t().resources}</h2>${gridOrEmpty(data.resources.map(resourceCard).join(""))}
    <h2>${t().rooms}</h2>${gridOrEmpty((data.rooms || []).map(roomCard).join(""))}
    <h2>${t().eventsTitle}</h2>${gridOrEmpty((data.events || []).map(communityEventCard).join(""))}`;
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
        ${row.photo ? `<img class="detail-photo" src="${escapeAttr(row.photo)}" alt="${escapeAttr(row.title)}" width="960" height="600" />` : ""}
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
  const data = await api("/api/admin/review");
  const reviewCard = (kind, row, extra) => `<article class="card is-static">
      <span class="tag">${t()[row.status] || row.status}</span>
      <strong>${escapeHtml(row.title)}</strong>
      <p class="blurb">${escapeHtml(extra)}</p>
      <p>
        ${row.status === "pending" ? `<button type="button" class="primary" data-admin-review="${kind}" data-id="${row.id}" data-admin-action="approve">${t().approve}</button>` : ""}
        ${row.status === "pending" || row.status === "approved" ? `<button type="button" class="ghost" data-admin-review="${kind}" data-id="${row.id}" data-admin-action="hide">${t().hidePost}</button>` : ""}
      </p>
    </article>`;
  return `<p class="kicker">${t().adminTitle}</p>
    <div class="toolbar"><h1>${t().adminTitle}</h1>
    <button type="button" class="ghost" data-admin-logout>${t().signOut}</button></div>
    <h2>${t().reviewListings}</h2>
    ${gridOrEmpty((data.listings || []).map((row) => reviewCard("listings", row, row.neighborhood)).join(""))}
    <h2>${t().reviewNews}</h2>
    ${gridOrEmpty((data.news || []).map((row) => reviewCard("news", row, row.author)).join(""))}
    <h2>${t().reviewEvents}</h2>
    ${gridOrEmpty((data.events || []).map((row) => reviewCard("events", row, `${row.starts_on} · ${row.place}`)).join(""))}
    <h2>${t().rooms}</h2>
    ${(data.rooms || [])
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
  events: renderEvents,
  facebook: renderFacebook,
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
  main.classList.toggle("is-about", page === "about");
  main.classList.toggle("is-facebook", page === "facebook");
  main.innerHTML = "<p class='muted'>…</p>";
  try {
    if ((page === "listing" || page === "business") && id) {
      main.innerHTML = await renderDetail(page, id);
    } else if (page === "about" && id) {
      main.innerHTML = renderAboutTopic(id);
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
    ${field("photo", f.photo, "file", 'accept="image/jpeg,image/png"')}
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

function eventForm() {
  const f = t().form;
  return `<form class="stack" data-form="event">
    ${field("title", f.title)}
    ${field("body", f.body, "textarea")}
    ${field("place", f.place)}
    ${field("starts_on", f.startsOn, "date")}
    ${field("host_name", f.host)}
    ${field("host_email", f.email, "email")}
    ${honeypotAndAgree()}
    <button class="primary" type="submit">${f.submitEvent}</button>
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
  const forms = { business: businessForm, news: newsForm, event: eventForm, room: roomForm, listing: listingForm };
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
  const review = event.target.closest("[data-admin-review]");
  if (review) {
    api(`/api/admin/${review.dataset.adminReview}/${review.dataset.id}/${review.dataset.adminAction}`, {
      method: "POST",
      body: "{}",
    })
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
  const file = form.elements.namedItem("photo")?.files?.[0];
  delete data.photo;
  const path =
    form.dataset.form === "business"
      ? "/api/businesses"
      : form.dataset.form === "news"
        ? "/api/news"
        : form.dataset.form === "event"
          ? "/api/events"
          : form.dataset.form === "room"
            ? "/api/rooms"
            : "/api/listings";
  try {
    if (file) {
      if (file.size > 700_000 || !/^image\/(jpeg|png)$/.test(file.type)) {
        status.dataset.state = "error";
        status.textContent = t().photoTooBig;
        return;
      }
      data.photo = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("photo"));
        reader.readAsDataURL(file);
      });
    }
    if (!state.csrf) await loadSession();
    await api(path, { method: "POST", body: JSON.stringify(data) });
    status.dataset.state = "ok";
    status.textContent = ["listing", "news", "event"].includes(form.dataset.form)
      ? t().postedPending
      : form.dataset.form === "room"
        ? t().roomRequested
        : t().posted;
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
