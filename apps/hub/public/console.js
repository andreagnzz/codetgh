// Console behavior that htmx does not cover: errors shown where the action was taken, a sober busy state,
// and the activity line marking only messages that were not on screen before. No library, no inline script.
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
})();
