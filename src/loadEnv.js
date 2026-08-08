const fs = require('node:fs');
const path = require('node:path');

/**
 * Minimal .env loader (no dependencies). Does not override existing process.env.
 * Supports KEY=VALUE lines; optional quotes; ignores comments/blank lines.
 */
function loadEnvFile(filePath = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) return { loaded: false, path: filePath, keys: [] };
  const keys = [];
  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, path: filePath, keys };
}

module.exports = { loadEnvFile };
