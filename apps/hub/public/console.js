// Console behavior that htmx does not cover: errors shown where the action was taken, a sober busy state, the activity line
// marking only messages that were not on screen before, the live state, the menus, the confirmation dialog, toasts, copying
// code, and times in the reader's time zone. No library, no inline script; every word comes from the page.
(() => {
  const fr = document.documentElement.lang === "fr";
  const GENERIC = fr
    ? "Le hub n'a pas pu traiter la demande. Réessaie ; si ça continue, regarde les journaux du hub."
    : "The hub could not handle the request. Try again; if it keeps failing, check the hub logs.";
  const OFFLINE = fr
    ? "Le hub ne répond pas. Vérifie ta connexion, puis réessaie."
    : "The hub does not answer. Check your connection, then try again.";

  // The confirmation dialog: a trigger with data-confirm is asked about first; its request leaves only on confirmation.
  const dialog = document.getElementById("confirm");
  const go = dialog?.querySelector("button[value='confirm']");
  const dialogError = document.getElementById("confirm-error");
  let pending = null;
  document.body.addEventListener("htmx:confirm", (e) => {
    const elt = e.detail.elt;
    if (!dialog || !go || !elt.dataset.confirm) return;
    e.preventDefault();
    pending = { elt, issue: e.detail.issueRequest };
    document.getElementById("confirm-title").textContent = elt.dataset.confirm;
    document.getElementById("confirm-body").textContent = elt.dataset.confirmBody ?? "";
    if (dialogError) {
      dialogError.textContent = "";
      dialogError.className = "";
    }
    go.textContent = elt.dataset.confirmAction ?? elt.textContent;
    go.className = elt.classList.contains("danger") ? "danger-fill" : "primary";
    dialog.showModal();
  });
  dialog?.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button?.value === "cancel") dialog.close();
    if (button === go && pending) pending.issue(true);
  });
  // Closed by Cancel, Escape or after the action: the keyboard goes back to the trigger.
  dialog?.addEventListener("close", () => {
    const elt = pending?.elt;
    pending = null;
    if (elt?.isConnected) elt.focus();
  });

  const hostOf = (elt) => elt.closest("form") ?? elt;
  const errorAfter = (host) => (host.nextElementSibling?.classList.contains("field-error") ? host.nextElementSibling : null);
  const errorIcon = () => document.getElementById("error-icon")?.content.firstElementChild?.cloneNode(true) ?? "";
  const show = (elt, text) => {
    // A refusal of a confirmed action shows in the dialog, which stays open.
    if (dialog?.open && pending?.elt === elt && dialogError) {
      dialogError.className = "field-error";
      dialogError.replaceChildren(errorIcon(), text);
      return;
    }
    const host = hostOf(elt);
    let p = errorAfter(host);
    if (!p) {
      p = document.createElement("p");
      p.className = "field-error";
      p.setAttribute("role", "alert");
      host.after(p);
    }
    p.replaceChildren(errorIcon(), text);
  };

  // Busy: the control, and the region it swaps; the stylesheet shows the signs only once the wait lasts.
  const busy = (e, on) => {
    for (const el of new Set([e.detail.elt, e.detail.target, pending?.elt === e.detail.elt ? go : null])) {
      if (!el || el === document.body) continue;
      if (on) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
    }
  };
  document.body.addEventListener("htmx:beforeRequest", (e) => {
    errorAfter(hostOf(e.detail.elt))?.remove();
    busy(e, true);
  });
  document.body.addEventListener("htmx:afterRequest", (e) => busy(e, false));
  // The hub answers a refused action with its reason (4xx); anything else gets a generic next step.
  document.body.addEventListener("htmx:responseError", (e) => {
    const { status, responseText } = e.detail.xhr;
    const reason = new DOMParser().parseFromString(responseText, "text/html").body.textContent?.trim();
    show(e.detail.elt, status < 500 && reason ? reason : GENERIC);
  });
  document.body.addEventListener("htmx:sendError", (e) => show(e.detail.elt, OFFLINE));

  // Toast: the result of an action that the page does not show (data-done on the trigger). Most actions reload the page,
  // so the sentence waits in sessionStorage; without it, the page works the same and says nothing.
  const KEY = "codetgh:toast";
  const toasts = document.querySelector(".toasts");
  let timer;
  const toast = (text) => {
    const node = document.getElementById("toast")?.content.firstElementChild?.cloneNode(true);
    if (!toasts || !node) return;
    node.querySelector("p").textContent = text;
    const close = () => {
      clearTimeout(timer);
      node.remove();
    };
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(close, 5000);
    };
    node.querySelector("button").addEventListener("click", close);
    node.addEventListener("mouseenter", () => clearTimeout(timer));
    node.addEventListener("mouseleave", wait);
    node.addEventListener("focusin", () => clearTimeout(timer));
    node.addEventListener("focusout", wait);
    toasts.replaceChildren(node);
    wait();
  };
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved) {
      sessionStorage.removeItem(KEY);
      toast(saved);
    }
  } catch {}
  document.body.addEventListener("htmx:beforeOnLoad", (e) => {
    const { elt, xhr } = e.detail;
    if (elt === pending?.elt && xhr.status < 400) dialog?.close();
    const done = elt.dataset?.done;
    if (!done || xhr.status >= 400) return;
    if (xhr.getResponseHeader("HX-Refresh") !== "true") return toast(done);
    try {
      sessionStorage.setItem(KEY, done);
    } catch {}
  });

  // Code blocks: copy the code; if the browser refuses, select it and say how.
  document.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-copy]");
    if (!button) return;
    const block = button.closest(".code");
    const code = block?.querySelector("code");
    if (!code) return;
    const hint = block.querySelector(".copy-hint");
    const status = block.querySelector("[role=status]");
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      button.dataset.state = "copied";
      if (status) status.textContent = button.querySelector(".when-copied")?.textContent ?? "";
      setTimeout(() => {
        delete button.dataset.state;
        if (status) status.textContent = "";
      }, 2000);
    } catch {
      getSelection()?.selectAllChildren(code);
      if (hint) {
        hint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? button.dataset.hintMac : button.dataset.hint;
        hint.hidden = false;
      }
    }
  });
  // A banner that can be dismissed (information only).
  document.addEventListener("click", (e) => e.target.closest("[data-dismiss]")?.closest(".banner")?.remove());

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

  // Absolute times: the hub writes them in its own time zone, the reader gets them in theirs, in the same format.
  const STAMP = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const clocks = () => {
    for (const t of document.querySelectorAll("time[data-local]"))
      t.textContent = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", STAMP).format(new Date(t.dateTime));
  };
  clocks();
  document.body.addEventListener("htmx:afterSettle", clocks);

  // The live state in the top bar follows the stream; its words come from the page (data-live, data-lost).
  const live = document.querySelector(".live");
  const state = (s) => {
    if (!live || live.dataset.state === s) return;
    live.dataset.state = s;
    live.textContent = live.dataset[s] ?? "";
  };
  document.body.addEventListener("htmx:sseOpen", () => state("live"));
  document.body.addEventListener("htmx:sseError", () => state("lost"));

  // Menus (account, small-screen menu, row menus) close on Escape, focus back on their button; the floating ones also close
  // on a click outside them.
  const MENUS = "details.account[open], details.menu[open], details.row-menu[open]";
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const menu of document.querySelectorAll(MENUS)) {
      menu.open = false;
      if (menu.contains(document.activeElement)) menu.querySelector("summary")?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    for (const menu of document.querySelectorAll("details.account[open], details.row-menu[open]"))
      if (!menu.contains(e.target)) menu.open = false;
  });
})();
