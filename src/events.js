export const OFFICIAL_EVENTS = [
  {
    id: "council",
    title: "Village Council meeting",
    title_es: "Reunión del Concejo de la Villa",
    when: "2nd and 4th Thursdays, 6 p.m.",
    when_es: "2.º y 4.º jueves, 6 p.m.",
    place: "Village Hall, 15516 SW Osceola St., Suite B",
    body: "Regular council meetings. Agenda packets and minutes stay on the Village site. Public comment is at the start of the meeting.",
    body_es: "Reuniones regulares del concejo. Las agendas y actas quedan en el sitio de la Villa. El comentario público es al inicio.",
    href: "https://www.indiantownfl.gov/village-clerk/page/village-council",
    source: "Village of Indiantown",
  },
  {
    id: "chamber",
    title: "Chamber of Commerce events",
    title_es: "Eventos de la Cámara de Comercio",
    when: "See the Chamber calendar",
    when_es: "Vea el calendario de la Cámara",
    place: "Indiantown Chamber of Commerce",
    body: "Business mixers, civic dates, and local promotions. Hours and tickets stay on the Chamber site.",
    body_es: "Encuentros de negocios, fechas cívicas y promociones locales. Horarios y boletos quedan en el sitio de la Cámara.",
    href: "https://www.indiantownchamber.com/",
    source: "Indiantown Chamber of Commerce",
  },
  {
    id: "library",
    title: "Elisabeth Lahti Library programs",
    title_es: "Programas de la biblioteca Elisabeth Lahti",
    when: "Tue 12–8; Wed–Sat 10–5:30",
    when_es: "Mar 12–8; mié–sáb 10–5:30",
    place: "15200 E. Thelma Waters Ave",
    body: "Story times, computer help, and county library programs. Closed Sunday and Monday.",
    body_es: "Hora del cuento, ayuda con computadoras y programas del sistema de bibliotecas. Cerrado domingo y lunes.",
    href: "https://www.martin.fl.us/elisabeth-lahti-library",
    source: "Martin County Library System",
  },
  {
    id: "parks",
    title: "Village parks and recreation",
    title_es: "Parques y recreación de la Villa",
    when: "See Parks & Recreation",
    when_es: "Vea Parques y Recreación",
    place: "Village of Indiantown parks",
    body: "Fields, sign-ups, and recreation programs. Confirm dates with Parks & Recreation.",
    body_es: "Campos, inscripciones y programas de recreación. Confirme las fechas con Parques y Recreación.",
    href: "https://www.indiantownfl.gov/contact-us",
    source: "Village of Indiantown",
  },
];

export function listOfficialEvents() {
  return OFFICIAL_EVENTS.map((row) => ({ ...row, kind: "official" }));
}
