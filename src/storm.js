export const STORM_LINKS = [
  {
    id: "911",
    title: "911 Emergency",
    title_es: "911 Emergencia",
    blurb: "Police, fire, or medical emergency. Call if someone is in danger.",
    blurb_es: "Policía, fuego o emergencia médica. Llame si alguien está en peligro.",
    href: "tel:911",
    phone: "911",
    site: "",
  },
  {
    id: "nws",
    title: "National Weather Service — Melbourne",
    title_es: "Servicio Meteorológico Nacional — Melbourne",
    blurb: "Watches, warnings, and forecasts for the Treasure Coast.",
    blurb_es: "Vigilancia, avisos y pronósticos para Treasure Coast.",
    href: "https://www.weather.gov/mlb/",
    phone: "",
    site: "https://www.weather.gov/mlb/",
  },
  {
    id: "em",
    title: "Martin County Emergency Management",
    title_es: "Emergencias del condado de Martin",
    blurb: "County storm plans, shelters, and recovery notices.",
    blurb_es: "Planes de tormenta, refugios y avisos de recuperación del condado.",
    href: "https://www.martin.fl.us/EM",
    phone: "(772) 287-1652",
    site: "https://www.martin.fl.us/EM",
  },
  {
    id: "alert",
    title: "Alert Martin",
    title_es: "Alert Martin",
    blurb: "Sign up for county emergency alerts by phone, text, or email.",
    blurb_es: "Regístrese para alertas de emergencia del condado por teléfono, texto o correo.",
    href: "https://www.martin.fl.us/AlertMartin",
    phone: "(772) 287-1652",
    site: "https://www.martin.fl.us/AlertMartin",
  },
  {
    id: "canal",
    title: "St. Lucie Canal (SFWMD)",
    title_es: "Canal St. Lucie (SFWMD)",
    blurb: "C-44 canal water and South Florida Water Management District notices.",
    blurb_es: "Agua del canal C-44 y avisos del Distrito de Gestión del Agua del Sur de la Florida.",
    href: "https://www.sfwmd.gov/",
    phone: "",
    site: "https://www.sfwmd.gov/",
  },
];

export function listStormLinks() {
  return STORM_LINKS.map((row) => ({ ...row }));
}
