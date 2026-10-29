// Console behavior that htmx does not cover: errors shown where the action was taken, a sober busy state, the activity line
// marking only messages that were not on screen before, the live state and the menus. No library, no inline script.
(() => {
  const fr = document.documentElement.lang === "fr";
  const GENERIC = fr
    ? "Le hub n'a pas pu traiter la demande. Réessaie ; si ça continue, regarde les journaux du hub."
    : "The hub could not handle the request. Try again; if it keeps failing, check the hub logs.";
  const OFFLINE = fr
    ? "Le hub ne répond pas. Vérifie ta connexion, puis réessaie."
    : "The hub does not answer. Check your connection, then try again.";

  const hostOf = (elt) => elt.closest("form") ?? elt;
  const errorAfter = (host) => (host.nextElementSibling?.classList.contains("field-error") ? host.nextElementSibling : null);
  const show = (elt, text) => {
    const host = hostOf(elt);
    let p = errorAfter(host);
    if (!p) {
      p = document.createElement("p");
      p.className = "field-error";
      p.setAttribute("role", "alert");
      host.after(p);
    }
    p.textContent = text;
  };

  document.body.addEventListener("htmx:beforeRequest", (e) => {
    errorAfter(hostOf(e.detail.elt))?.remove();
    e.detail.elt.setAttribute("aria-busy", "true");
  });
  document.body.addEventListener("htmx:afterRequest", (e) => e.detail.elt.removeAttribute("aria-busy"));
  // The hub answers a refused action with its reason (4xx); anything else gets a generic next step.
  document.body.addEventListener("htmx:responseError", (e) => {
    const { status, responseText } = e.detail.xhr;
    const reason = new DOMParser().parseFromString(responseText, "text/html").body.textContent?.trim();
    show(e.detail.elt, status < 500 && reason ? reason : GENERIC);
  });
  document.body.addEventListener("htmx:sendError", (e) => show(e.detail.elt, OFFLINE));

  // Activity line: a message seen for the first time after a live refresh traces its line once.
  const seen = new Set();
  const announce = document.getElementById("line-announce");
  const mark = (fresh) => {
    for (const row of document.querySelectorAll("[data-mid]")) {
      if (seen.has(row.dataset.mid)) continue;
      seen.add(row.dataset.mid);
      if (!fresh) continue;
      row.classList.add("fresh");
      if (announce) announce.textContent = row.dataset.summary ?? "";
    }
  };
  mark(false);
  document.body.addEventListener("htmx:afterSettle", () => mark(true));

  // The live state in the top bar follows the stream; its words come from the page (data-live, data-lost).
  const live = document.querySelector(".live");
  const state = (s) => {
    if (!live || live.dataset.state === s) return;
    live.dataset.state = s;
    live.textContent = live.dataset[s] ?? "";
  };
  document.body.addEventListener("htmx:sseOpen", () => state("live"));
  document.body.addEventListener("htmx:sseError", () => state("lost"));

  // The account menu and the small-screen menu close on Escape, focus back on their button; the account menu also closes on a
  // click outside it.
  const MENUS = "details.account[open], details.menu[open]";
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const menu of document.querySelectorAll(MENUS)) {
      menu.open = false;
      if (menu.contains(document.activeElement)) menu.querySelector("summary")?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    for (const menu of document.querySelectorAll("details.account[open]")) if (!menu.contains(e.target)) menu.open = false;
  });
})();
