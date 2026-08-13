export function parseHash(hash) {
  const parts = String(hash || "")
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  return { page: parts[0] || "", id: parts[1] || "" };
}
