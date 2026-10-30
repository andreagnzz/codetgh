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
  const STALE = fr ? "Impossible d'actualiser. Les données affichées datent de {time}." : "Couldn't refresh. Showing data from {time}.";
  const CLOCK = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

  // The confirmation dialog: a trigger with data-confirm is asked about first; its request leaves only on confirmation. In a
  // form, the button that sent it may ask instead of the form, with its own words.
  const dialog = document.getElementById("confirm");
  const go = dialog?.querySelector("button[value='confirm']");
  const dialogError = document.getElementById("confirm-error");
  let pending = null;
  // A form asks through the button that sent it (its first one otherwise), which carries the level and takes the focus back.
  const triggerOf = (elt, by) => (elt.matches("form") ? (by ?? elt.querySelector("[type=submit]")) : elt);
  document.body.addEventListener("htmx:confirm", (e) => {
    const elt = e.detail.elt;
    const by = elt.matches("form") ? e.detail.triggeringEvent?.submitter : null;
    const ask = elt.dataset.confirm ? elt : by?.dataset.confirm ? by : null;
    if (!dialog || !go || !ask) return;
    e.preventDefault();
    // htmx forgets which button sent the form once the dialog takes the focus: the confirmed request carries its value.
    if (by?.name) e.detail.etc.values = { ...e.detail.etc.values, [by.name]: by.value };
    pending = { elt, by, issue: e.detail.issueRequest };
    document.getElementById("confirm-title").textContent = ask.dataset.confirm;
    document.getElementById("confirm-body").textContent = ask.dataset.confirmBody ?? "";
    if (dialogError) {
      dialogError.textContent = "";
      dialogError.className = "";
    }
    go.textContent = ask.dataset.confirmAction ?? ask.textContent;
    go.className = triggerOf(elt, by)?.classList.contains("danger") ? "danger-fill" : "primary";
    dialog.showModal();
  });
  dialog?.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button?.value === "cancel") dialog.close();
    // One request per confirmation: a second click while it runs would queue another, which asks again.
    if (button === go && pending && !pending.sent) {
      pending.sent = true;
      pending.issue(true);
    }
  });
  // While the dialog asks, a live refresh does not replace its trigger: the confirmation would have nothing left to send.
  document.body.addEventListener("htmx:beforeSwap", (e) => {
    if (dialog?.open && pending && e.detail.elt !== pending.elt && e.detail.target?.contains(pending.elt)) e.detail.shouldSwap = false;
  });
  // Closed by Cancel, Escape or after the action: the keyboard goes back to the trigger, or to the button of the row menu that
  // held it, which closed when the dialog took the focus.
  dialog?.addEventListener("close", () => {
    const back = pending && triggerOf(pending.elt, pending.by);
    pending = null;
    if (!back?.isConnected) return;
    (back.closest("details:not([open])")?.querySelector("summary") ?? back).focus();
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
  // A region the stream refreshes keeps what it shows when a refresh fails: the words say so, with the reader's clock time of
  // its last load.
  const liveRegion = (elt) => elt.matches?.("[hx-trigger*='sse:']");
  let loadedAt = new Date();
  const stale = () => STALE.replace("{time}", new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", CLOCK).format(loadedAt));
  document.body.addEventListener("htmx:afterRequest", (e) => {
    busy(e, false);
    // Refused, the dialog stays open and can be confirmed again.
    if (pending?.elt === e.detail.elt) pending.sent = false;
    if (e.detail.successful && liveRegion(e.detail.elt)) loadedAt = new Date();
  });
  // The hub answers a refused action with its reason (4xx); anything else gets a generic next step.
  document.body.addEventListener("htmx:responseError", (e) => {
    const { status, responseText } = e.detail.xhr;
    const reason = new DOMParser().parseFromString(responseText, "text/html").body.textContent?.trim();
    show(e.detail.elt, liveRegion(e.detail.elt) ? stale() : status < 500 && reason ? reason : GENERIC);
  });
  document.body.addEventListener("htmx:sendError", (e) => show(e.detail.elt, liveRegion(e.detail.elt) ? stale() : OFFLINE));

  // Removing what holds the focus (a toast, a dismissed banner) gives it back to where it came from, or to the page.
  const cameFrom = new WeakMap();
  document.addEventListener("focusin", (e) => {
    const host = e.target.closest?.(".toast, .banner");
    if (host && !host.contains(e.relatedTarget)) cameFrom.set(host, e.relatedTarget);
  });
  const removeKeepingFocus = (node) => {
    const had = node.contains(document.activeElement);
    const back = cameFrom.get(node);
    node.remove();
    if (!had) return;
    if (back?.isConnected) return back.focus();
    const main = document.getElementById("main");
    main?.setAttribute("tabindex", "-1");
    main?.focus();
  };

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
      removeKeepingFocus(node);
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
  document.addEventListener("click", (e) => {
    const banner = e.target.closest("[data-dismiss]")?.closest(".banner");
    if (banner) removeKeepingFocus(banner);
  });

  // A table wider than its frame scrolls inside it: the frame then takes the keyboard (arrows scroll it) and its name.
  const frames = () => {
    for (const wrap of document.querySelectorAll(".table-wrap")) {
      if (wrap.scrollWidth > wrap.clientWidth + 1) {
        wrap.setAttribute("role", "region");
        wrap.setAttribute("tabindex", "0");
        wrap.setAttribute("aria-label", wrap.querySelector("caption")?.textContent || document.querySelector("h1")?.textContent || "");
      } else for (const a of ["role", "tabindex", "aria-label"]) wrap.removeAttribute(a);
    }
  };
  frames();
  addEventListener("resize", frames);
  document.body.addEventListener("htmx:afterSettle", frames);

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

  // A live refresh opens again the disclosures that were open in what it replaces (those with an id).
  let opened = [];
  document.body.addEventListener("htmx:beforeSwap", (e) => {
    opened = [...(e.detail.target?.querySelectorAll("details[open][id]") ?? [])].map((d) => d.id);
  });
  document.body.addEventListener("htmx:afterSwap", () => {
    for (const id of opened) document.getElementById(id)?.setAttribute("open", "");
  });

  // Absolute times: the hub writes them in its own time zone, the reader gets them in theirs, in the same format: the clock
  // alone for a time from today, the day and month before it on another day.
  const clocks = () => {
    const today = new Date().toDateString();
    for (const t of document.querySelectorAll("time[data-local]")) {
      const d = new Date(t.dateTime);
      const format = d.toDateString() === today ? CLOCK : { day: "numeric", month: "short", ...CLOCK };
      t.textContent = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", format).format(d);
    }
  };
  clocks();
  document.body.addEventListener("htmx:afterSettle", clocks);

  // The live state in the top bar follows the stream; its words come from the page (data-live, data-lost, data-offline). It
  // shows once this script runs, and becomes a live region after the first connection, so a page load announces nothing.
  // Three failed attempts in a row, or a closed stream, read as offline since the connection was lost.
  const live = document.querySelector(".live");
  if (live) live.hidden = false;
  let failures = 0;
  let lostAt = null;
  const state = (s) => {
    if (!live || live.dataset.state === s) return;
    live.dataset.state = s;
    const at = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
      lostAt ?? new Date(),
    );
    live.textContent = (live.dataset[s] ?? "").replace("{time}", at);
  };
  document.body.addEventListener("htmx:sseOpen", () => {
    failures = 0;
    lostAt = null;
    state("live");
    live?.setAttribute("role", "status");
  });
  const lost = (closed) => {
    lostAt ??= new Date();
    failures += 1;
    state(closed || failures >= 3 ? "offline" : "lost");
  };
  document.body.addEventListener("htmx:sseError", () => lost(false));
  document.body.addEventListener("htmx:sseClose", () => lost(true));

  // Menus (account, small-screen menu, row menus, project filter) close on Escape, focus back on their button. The floating
  // ones also close on a click outside them, and when the keyboard leaves them, so they never cover the next stop. A focus
  // that goes nowhere (a click on plain text, another window) keeps them open.
  const FLOATING = "details.account[open], details.row-menu[open], details.projects-filter[open]";
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const menu of document.querySelectorAll(`${FLOATING}, details.menu[open]`)) {
      menu.open = false;
      if (menu.contains(document.activeElement)) menu.querySelector("summary")?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    for (const menu of document.querySelectorAll(FLOATING)) if (!menu.contains(e.target)) menu.open = false;
  });
  document.addEventListener("focusout", (e) => {
    if (!(e.relatedTarget instanceof Node)) return;
    for (const menu of document.querySelectorAll(FLOATING))
      if (menu.contains(e.target) && !menu.contains(e.relatedTarget)) menu.open = false;
  });
})();
