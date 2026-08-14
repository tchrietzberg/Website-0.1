import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function uploadDir() {
  return process.env.UPLOAD_DIR || join(root, "data", "uploads", "listings");
}

const JPEG = Buffer.from([0xff, 0xd8]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function decodeListingPhoto(input) {
  const raw = String(input || "").trim();
  if (!raw) return { ok: true, value: null };
  const match = raw.match(/^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return { ok: false, field: "photo", error: "Photo must be a JPEG or PNG." };
  let buf;
  try {
    buf = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  } catch {
    return { ok: false, field: "photo", error: "Photo could not be read." };
  }
  if (buf.length < 24 || buf.length > 700_000) {
    return { ok: false, field: "photo", error: "Photo must be under 700 KB." };
  }
  const mime = match[1].toLowerCase();
  if (mime === "image/jpeg" && !buf.subarray(0, 2).equals(JPEG)) {
    return { ok: false, field: "photo", error: "Photo must be a JPEG or PNG." };
  }
  if (mime === "image/png" && !buf.subarray(0, 4).equals(PNG)) {
    return { ok: false, field: "photo", error: "Photo must be a JPEG or PNG." };
  }
  return { ok: true, value: { buf, ext: mime === "image/png" ? "png" : "jpg" } };
}

export function saveListingPhoto(id, photo) {
  if (!photo?.buf) return null;
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  const name = `${Number(id)}.${photo.ext}`;
  writeFileSync(join(dir, name), photo.buf);
  return `/uploads/listings/${name}`;
}

export function readListingUpload(pathname) {
  const match = String(pathname || "").match(/^\/uploads\/listings\/(\d+)\.(jpg|png)$/);
  if (!match) return null;
  const file = join(uploadDir(), `${match[1]}.${match[2]}`);
  if (!file.startsWith(uploadDir()) || !existsSync(file)) return null;
  return {
    body: readFileSync(file),
    type: match[2] === "png" ? "image/png" : "image/jpeg",
  };
}
