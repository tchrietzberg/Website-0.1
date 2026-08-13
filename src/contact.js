const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact({ name, email, message }) {
  const next = {
    name: String(name || "").trim(),
    email: String(email || "").trim(),
    message: String(message || "").trim(),
  };

  if (next.name.length < 2) {
    return { ok: false, field: "name", error: "Please add your name." };
  }
  if (!EMAIL.test(next.email)) {
    return { ok: false, field: "email", error: "Please use a valid email address." };
  }
  if (next.message.length < 8) {
    return { ok: false, field: "message", error: "Please write a short note so I know how to help." };
  }
  return { ok: true, value: next };
}

export function buildMailto({ name, email, message }, to = "tchrietzberg@gmail.com") {
  const subject = encodeURIComponent(`Website 0.1 — note from ${name}`);
  const body = encodeURIComponent(`${message}\n\n— ${name}\n${email}`);
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
