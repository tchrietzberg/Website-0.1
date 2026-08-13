import { buildMailto, validateContact } from "./contact.js";

const nav = document.querySelector("[data-nav]");
const toggle = document.querySelector("[data-nav-toggle]");
const year = document.querySelector("[data-year]");
const form = document.querySelector("[data-contact-form]");
const status = document.querySelector("[data-form-status]");

if (year) {
  year.textContent = String(new Date().getFullYear());
}

if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

function setStatus(message, state) {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

if (form && status) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const result = validateContact({
      name: data.get("name"),
      email: data.get("email"),
      message: data.get("message"),
    });

    if (!result.ok) {
      setStatus(result.error, "error");
      form.elements.namedItem(result.field)?.focus();
      return;
    }

    window.location.href = buildMailto(result.value);
    setStatus("Opening your email app with the message drafted.", "ok");
    form.reset();
  });
}
