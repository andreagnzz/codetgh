// Console and public pages in English or French, from the browser's first language. English strings are the keys.
export type Lang = "en" | "fr";

// The lang cookie, set by the console's language switch, wins over the browser's language.
export const langOf = (acceptLanguage: string | null | undefined, cookie?: string | null): Lang =>
  (cookie?.match(/(?:^|;\s*)lang=(en|fr)(?:;|$)/)?.[1] as Lang | undefined) ??
  ((acceptLanguage ?? "").trim().toLowerCase().startsWith("fr") ? "fr" : "en");

const FR: Record<string, string> = {
  // Layout
  "Skip to content": "Aller au contenu",
  Console: "Console",
  Overview: "Vue d'ensemble",
  Threads: "Fils",
  Agents: "Agents",
  Projects: "Projets",
  Project: "Projet",
  "Autonomous sessions (bypassPermissions) cannot answer a question: CodeTgh warns them instead of asking. Choose warn for teams that run them.":
    "Les sessions autonomes (bypassPermissions) ne peuvent pas répondre à une question : CodeTgh les prévient au lieu de demander. Choisis « prévenir l'agent » pour les équipes qui en utilisent.",
  Remove: "Retirer",
  Delegations: "Délégations",
  "These sessions do tasks that the listed teammates send them, without a human, in Claude Code's auto mode.":
    "Ces sessions font les tâches que leur envoient les coéquipiers listés, sans humain, dans le mode auto de Claude Code.",
  "Accepts requests from": "Accepte les demandes de",
  "No delegate session. A member starts one with codetgh start --accept-requests-from @handle.":
    "Aucune session déléguée. Un membre en lance une avec codetgh start --accept-requests-from @pseudo.",
  "Turn off": "Couper",
  "Permission prompts are off in this session": "Les demandes de permission sont désactivées dans cette session",
  "Project id": "Identifiant du projet",
  "Remote Control running": "Remote Control en marche",
  "Remote Control stopped": "Remote Control arrêté",
  "Waiting for the launcher on your machine": "En attente du lanceur sur ta machine",
  "Start Remote Control": "Démarrer Remote Control",
  "Stop Remote Control": "Arrêter Remote Control",
  "Open claude.ai/code": "Ouvrir claude.ai/code",
  "Runner on": "Runner en marche",
  "agents running": "agents en cours",
  "Runner stopped": "Runner arrêté",
  "Waiting for the runner on your machine": "En attente du runner sur ta machine",
  "Start the runner": "Démarrer le runner",
  "Stop the runner": "Arrêter le runner",
  "Sessions outside a project": "Sessions hors projet",
  "All projects": "Tous les projets",
  "Outside a project": "Hors projet",
  "Back to threads": "Retour aux fils",
  "Back to tasks": "Retour aux tâches",
  "Start claude inside the project's repository folder to link the session.":
    "Lancez claude dans le dossier du dépôt du projet pour y rattacher la session.",
  "Attach to…": "Rattacher à…",
  "Choose a project.": "Choisissez un projet.",
  "No session on this project right now.": "Aucune session sur ce projet pour l'instant.",
  "No project yet. A project appears when a member runs codetgh start in a repository, or runs codetgh project new there.":
    "Aucun projet pour l'instant. Un projet apparaît quand un membre lance codetgh start dans un dépôt, ou y lance codetgh project new.",
  Claims: "Réservations",
  Tasks: "Tâches",
  Memory: "Mémoire",
  Tokens: "Jetons",
  "Sign in a terminal": "Connecter un terminal",
  "Code shown in your terminal": "Code affiché dans ton terminal",
  Continue: "Continuer",
  "Type the 8-letter code your terminal shows.": "Tape le code de 8 lettres affiché dans ton terminal.",
  Machine: "Machine",
  "typed by whoever started this request, so it proves nothing": "tapé par la personne qui a lancé la demande, donc ça ne prouve rien",
  Started: "Lancée",
  "Approve only if you just ran codetgh in your own terminal and it shows this code. It gets a personal token for you.":
    "N'approuve que si tu viens de lancer codetgh dans ton propre terminal et qu'il affiche ce code. Il recevra un jeton personnel à ton nom.",
  Approve: "Approuver",
  "Approved. Go back to your terminal: it finishes on its own.": "Approuvé. Retourne dans ton terminal : il termine tout seul.",
  "Denied. No token was created.": "Refusé. Aucun jeton n'a été créé.",
  "My data": "Mes données",
  Alerts: "Alertes",
  Members: "Membres",
  Audit: "Audit",
  Settings: "Paramètres",
  "Nothing yet.": "Rien pour l'instant.",
  // French puts a space before a colon.
  ": ": " : ",
  // States
  instruction_like: "ressemble à une consigne",
  secret_blocked: "secret bloqué",
  loop_guard: "boucle d'agents",
  loop_needs_human: "boucle : décision humaine",
  audit_tamper: "journal d'audit altéré",
  online: "en ligne",
  idle: "inactif",
  offline: "hors ligne",
  trusted: "de confiance",
  quarantined: "en quarantaine",
  open: "ouverte",
  dismissed: "ignorée",
  false_positive: "faux positif",
  fingerprint_allowed: "empreinte autorisée",
  invited: "invité",
  "to validate": "à valider",
  owner: "propriétaire",
  admin: "admin",
  member: "membre",
  guest: "invité",
  // Dashboard
  "On the line": "Sur la ligne",
  Presence: "Présence",
  Offline: "Hors ligne",
  "To handle": "À traiter",
  "Nothing to handle.": "Rien à traiter.",
  "Team memory to validate": "Mémoire d'équipe à valider",
  "Review alerts": "Voir les alertes",
  "Invitations not accepted yet": "Invitations pas encore acceptées",
  "Kill switch": "Coupure",
  Reason: "Motif",
  "Stop agent traffic": "Couper le trafic des agents",
  "Type yes to resume agent traffic": "Tape yes pour rétablir le trafic des agents",
  Resume: "Rétablir",
  "No agent connected. Copy the invitation command to add one: codetgh invite <email>.":
    "Aucun agent connecté. Copie la commande d'invitation pour en ajouter un : codetgh invite <email>.",
  "No agent connected yet. Install CodeTgh with codetgh setup, then run codetgh start in the team's repository.":
    "Aucun agent connecté pour l'instant. Installe CodeTgh avec codetgh setup, puis lance codetgh start dans le dépôt de l'équipe.",
  "No messages yet. When agents talk, each message appears here as a line between them.":
    "Aucun message pour l'instant. Quand des agents se parlent, chaque message apparaît ici comme une ligne entre eux.",
  Earlier: "Plus ancien",
  "Open thread": "Ouvrir le fil",
  "(agent)": "(agent)",
  "New message": "Nouveau message",
  "the thread": "le fil",
  "a teammate": "un coéquipier",
  to: "à",
  // Kinds
  question: "question",
  answer: "réponse",
  note: "note",
  request: "demande",
  status: "statut",
  alert: "alerte",
  handoff: "relais",
  // Agents
  Who: "Qui",
  Label: "Libellé",
  Kind: "Type",
  Branch: "Branche",
  "Last seen": "Vu",
  Trust: "Confiance",
  Actions: "Actions",
  Quarantine: "Mettre en quarantaine",
  Confirm: "Confirmer",
  "external: always quarantined": "externe : toujours en quarantaine",
  "External agent (A2A)": "Agent externe (A2A)",
  "An external agent can ask the team questions and read the answers. It stays in quarantine: no claims, memory or tasks.":
    "Un agent externe peut poser des questions à l'équipe et lire les réponses. Il reste en quarantaine : ni réservation, ni mémoire, ni tâche.",
  Name: "Nom",
  Create: "Créer",
  "No agent yet. Agents appear here once someone runs codetgh setup, then codetgh start in a team repository.":
    "Aucun agent pour l'instant. Ils apparaissent ici dès que quelqu'un lance codetgh setup, puis codetgh start dans un dépôt de l'équipe.",
  // Alerts
  Sender: "Expéditeur",
  Excerpt: "Extrait",
  Status: "État",
  Dismiss: "Ignorer",
  "False positive": "Faux positif",
  "Allow this fingerprint": "Autoriser cette empreinte",
  "Quarantine sender": "Mettre l'expéditeur en quarantaine",
  "No alerts. Messages that look like instructions, or that carry a secret, show up here for an admin to decide.":
    "Aucune alerte. Les messages qui ressemblent à des consignes, ou qui contiennent un secret, arrivent ici pour qu'un admin décide.",
  // Threads
  Thread: "Fil",
  Subject: "Sujet",
  "Agent streak": "Série d'agents",
  State: "État",
  "Last message": "Dernier message",
  Older: "Plus anciens",
  "Join {team}": "Rejoindre {team}",
  "Showing {shown} of {total}": "{shown} affichés sur {total}",
  Current: "En cours",
  Archives: "Archives",
  "No archived threads.": "Aucun fil archivé.",
  muted: "en sourdine",
  "No threads yet. A thread starts with the first message an agent or a person sends.":
    "Aucun fil pour l'instant. Un fil commence au premier message envoyé par un agent ou une personne.",
  // Members and invitations
  Email: "E-mail",
  Role: "Rôle",
  Invite: "Inviter",
  "Valid for (days)": "Valable (jours)",
  valid: "valable",
  days: "jours",
  "Revoke invitation": "Annuler l'invitation",
  Rename: "Renommer",
  "Display name": "Nom affiché",
  "Team name": "Nom de l'équipe",
  "Rename the team": "Renommer l'équipe",
  Invitations: "Invitations",
  Sent: "Envoyée",
  Expires: "Expire",
  Handle: "Identifiant",
  Revoke: "Révoquer",
  "Make owner": "Rendre propriétaire",
  "Make admin": "Rendre admin",
  "Make member": "Rendre membre",
  "Make guest": "Rendre invité",
  "No pending invitations. Invite someone with the form above, or run codetgh invite <email>.":
    "Aucune invitation en attente. Invite quelqu'un avec le formulaire ci-dessus, ou lance codetgh invite <email>.",
  "Invitation emailed to": "Invitation envoyée par e-mail à",
  "Send this link to": "Envoie ce lien à",
  "valid 7 days": "valable 7 jours",
  // Settings
  "Message retention (days)": "Conservation des messages (jours)",
  "Extra secret patterns (regular expressions, one per line)": "Motifs de secrets en plus (expressions régulières, une par ligne)",
  "When an agent edits a file someone else claimed": "Quand un agent modifie un fichier réservé par quelqu'un d'autre",
  "warn the agent, never block": "prévenir l'agent, sans jamais bloquer",
  "ask the human (default)": "demander à l'humain (par défaut)",
  "Who accepts team memory": "Qui accepte la mémoire d'équipe",
  "and above": "et plus",
  "Allow accepting memory from Claude Code (asks the user every time; claude.ai and the Agent SDK cannot guarantee that)":
    "Autoriser l'acceptation de la mémoire depuis Claude Code (demande à chaque fois ; claude.ai et l'Agent SDK ne peuvent pas le garantir)",
  "Link a new repository when a member starts a session in it (otherwise an admin runs codetgh project new)":
    "Lier un nouveau dépôt quand un membre y ouvre une session (sinon un administrateur lance codetgh project new)",
  "Allow rewake push: an idle Claude Code session wakes up when a message arrives (each member also turns it on in the plugin)":
    "Autoriser le réveil : une session Claude Code inactive se réveille à l'arrivée d'un message (chaque membre l'active aussi dans le plugin)",
  "Slack channel id for alerts and blocking requests (e.g. C0123ABC)":
    "Identifiant du canal Slack pour les alertes et demandes bloquantes (ex. C0123ABC)",
  "Loop orchestrator: handle of the member whose agent judges muted agent loops (empty: a human reopens)":
    "Orchestrateur de boucles : handle du membre dont l'agent juge les boucles d'agents mises en sourdine (vide : un humain rouvre)",
  Save: "Enregistrer",
  "Agent rules": "Règles des agents",
  Bridges: "Ponts",
  "GitHub bridge": "Pont GitHub",
  "webhook configured": "webhook configuré",
  "not configured": "non configuré",
  "Replace the webhook secret": "Remplacer le secret du webhook",
  "Create the webhook": "Créer le webhook",
  "Audit public key": "Clé publique de l'audit",
  "key id": "identifiant",
  // Public pages
  "Sign in to CodeTgh": "Se connecter à CodeTgh",
  "Sign in with your organization": "Se connecter avec ton organisation",
  "Sign in with GitHub": "Se connecter avec GitHub",
  "Sign in with Google": "Se connecter avec Google",
  Password: "Mot de passe",
  "Sign in": "Se connecter",
  "Or get a sign-in link by email": "Ou recevoir un lien de connexion par e-mail",
  "Email me a link": "M'envoyer un lien",
  "Allow access to CodeTgh?": "Autoriser l'accès à CodeTgh ?",
  Client: "Client",
  Scopes: "Portées",
  "You will be sent back to": "Tu seras renvoyé vers",
  Allow: "Autoriser",
  Deny: "Refuser",
  "Join {team} on CodeTgh": "Rejoindre {team} sur CodeTgh",
  "Invited as": "Invité comme",
  with: "avec",
  "Your name": "Ton nom",
  "Create my account": "Créer mon compte",
  "Already have an account?": "Déjà un compte ?",
  "This invitation is no longer valid.": "Cette invitation n'est plus valable.",
  "Ask the person who invited you for a new link.": "Demande un nouveau lien à la personne qui t'a invité.",

  // ---- Foundations (refonte/fondations): shell, components, error pages. ----
  "This request isn't valid.": "Cette demande n'est pas valable.",
  "You can't open this page.": "Tu ne peux pas ouvrir cette page.",
  "This page doesn't exist.": "Cette page n'existe pas.",
  "The hub refused this request.": "Le hub a refusé cette demande.",
  "Check the link, or go back and try again.": "Vérifie le lien, ou reviens en arrière et réessaie.",
  "Your role doesn't allow it. Ask an admin of your team if you need it.":
    "Ton rôle ne le permet pas. Demande à un admin de ton équipe si tu en as besoin.",
  "Check the link, or start again from the overview.": "Vérifie le lien, ou repars de la vue d'ensemble.",
  "Go back and try again.": "Reviens en arrière et réessaie.",
  "Back to the overview": "Retour à la vue d'ensemble",
  "admins only": "réservé aux admins",
  "guests see only their own threads": "un invité ne voit que ses propres fils",
  "thread not found": "fil introuvable",
  "task not found": "tâche introuvable",
  "no such item": "élément introuvable",
  "unknown status": "état inconnu",
  Menu: "Menu",
  Close: "Fermer",
  Live: "En direct",
  "Connecting…": "Connexion…",
  "Reconnecting…": "Reconnexion…",
  "Agent traffic stopped": "Trafic des agents coupé",
  "Resume agent traffic": "Rétablir le trafic des agents",
  Cancel: "Annuler",
  Copy: "Copier",
  Copied: "Copié",
  "Press Ctrl+C to copy": "Appuie sur Ctrl+C pour copier",
  "Press ⌘C to copy": "Appuie sur ⌘C pour copier",
  Pages: "Pages",
  Newer: "Plus récents",
  Newest: "Les plus récents",
  optional: "facultatif",
  "Loading…": "Chargement…",
  "Show {n} earlier events": "Afficher les {n}\u00a0événements précédents",
  Unread: "Non lu",
  "Offline since {time}": "Hors ligne depuis {time}",
  "Stop agent traffic…": "Couper le trafic des agents…",
  "Stop agent traffic?": "Couper le trafic des agents\u202f?",
  "Agents can't send messages or claim files until an admin resumes agent traffic.":
    "Les agents ne peuvent plus envoyer de messages ni réserver de fichiers tant qu'un admin n'a pas rétabli le trafic.",
  "The hub said: {reason}": "Réponse du hub\u00a0: {reason}",
  "You can't join with this invitation.": "Tu ne peux pas rejoindre l'équipe avec cette invitation.",
  "Sign in with the account it was sent to, or ask the person who invited you for a new link.":
    "Connecte-toi avec le compte auquel elle a été envoyée, ou demande un nouveau lien à la personne qui t'a invité.",
  "Sign in with another account": "Se connecter avec un autre compte",
  "This invitation is for another email address.": "Cette invitation est pour une autre adresse de courriel.",
  "Your email address is not verified: sign in with an email link, then open the invitation again.":
    "Ton adresse de courriel n'est pas vérifiée\u00a0: connecte-toi avec un lien reçu par courriel, puis rouvre l'invitation.",
  "You are already in a team.": "Tu fais déjà partie d'une équipe.",
  "This invitation was sent before your removal: ask for a new one.":
    "Cette invitation a été envoyée avant ton retrait\u00a0: demandes-en une nouvelle.",
  // ---- End of the foundations block. ----

  // ---- Batch 1, public pages (refonte/pages-publiques). Only that batch edits this block. ----
  // ---- End of batch 1. ----

  // ---- Batch 2, overview and live feed (refonte/vue-ensemble). Only that batch edits this block. ----
  // ---- End of batch 2. ----

  // ---- Batch 3, threads, the thread page and alerts (refonte/fils-alertes). Only that batch edits this block. ----
  // ---- End of batch 3. ----

  // ---- Batch 4, agents, projects and delegations (refonte/agents-projets). Only that batch edits this block. ----
  // A session, on Agents, Projects and Delegations. Online, Idle, External, Prompts off and Quarantined are batch 2's keys.
  Paused: "En pause",
  Push: "Réception",
  "While working": "Pendant le travail",
  "Wakes up": "Se réveille",
  "Live channel": "Canal en direct",
  "Not reported": "Non transmis",
  Bridge: "Pont",
  "Other client": "Autre client",
  // Agents.
  "Every session connected to the team, by project. Quarantine a session that misbehaves, remove one nobody uses.":
    "Toutes les sessions connectées à l'équipe, par projet. Mets en quarantaine une session qui se comporte mal, retire celle que personne n'utilise.",
  "Your sessions on this hub, by project.": "Tes sessions sur ce hub, par projet.",
  "Lift quarantine": "Lever la quarantaine",
  "Actions for {session}": "Actions pour {session}",
  "Quarantine {name}?": "Mettre {name} en quarantaine\u202f?",
  "All of their sessions can then send only notes, questions and answers: no claims, tasks, requests, handoffs or team memory, and no delegation. Only an admin lifts it.":
    "Toutes ses sessions ne pourront plus envoyer que des notes, des questions et des réponses\u00a0: ni réservation, ni tâche, ni demande, ni relais, ni mémoire d'équipe, ni délégation. Seul un admin la lève.",
  "Remove {session}?": "Retirer {session}\u202f?",
  "The session leaves every list and its claims are released. Its messages stay in their threads. If it resumes, it comes back.":
    "La session quitte toutes les listes et ses réservations sont libérées. Ses messages restent dans leurs fils. Si elle reprend, elle revient.",
  "{session} removed.": "{session} retirée.",
  "External agents": "Agents externes",
  "Remove the external agent {name}?": "Retirer l'agent externe {name}\u202f?",
  "Its token stops working at once. Its messages stay in their threads.":
    "Son jeton cesse aussitôt de fonctionner. Ses messages restent dans leurs fils.",
  "External agent {name} removed.": "Agent externe {name} retiré.",
  "No sessions yet.": "Aucune session pour l'instant.",
  "Sessions appear here once someone sets up CodeTgh, then starts Claude Code with it in a team repository.":
    "Les sessions apparaissent ici dès que quelqu'un installe CodeTgh, puis lance Claude Code avec lui dans un dépôt de l'équipe.",
  "Copy codetgh setup": "Copier codetgh setup",
  "Copy codetgh start": "Copier codetgh start",
  "No sessions in {project}.": "Aucune session dans {project}.",
  "No sessions outside a project.": "Aucune session hors projet.",
  "Add an external agent": "Ajouter un agent externe",
  Add: "Ajouter",
  "Copy the token now.": "Copie le jeton maintenant.",
  "It is shown once. Give these two lines to the external agent's operator.":
    "Il n'est affiché qu'une fois. Donne ces deux lignes à la personne qui fait tourner l'agent externe.",
  "Copy the two lines": "Copier les deux lignes",
  "It appears to the team as {handle}.": "L'équipe le voit sous le pseudo {handle}.",
  // Projects.
  "Each team repository and the sessions working in it.": "Chaque dépôt de l'équipe et les sessions qui y travaillent.",
  "Actions for {project}": "Actions pour {project}",
  "Remote Control and the runner start on your machine, only in the folders you listed there.":
    "Remote Control et le runner démarrent sur ta machine, seulement dans les dossiers que tu y as listés.",
  "Remote Control failed": "Remote Control en échec",
  "Runner failed": "Runner en échec",
  "Runner on · 1\u00a0agent running": "Runner en marche · 1\u00a0agent en cours",
  "Runner on · {n}\u00a0agents running": "Runner en marche · {n}\u00a0agents en cours",
  "Start claude inside the project's repository folder to link a session, or attach one to a project here.":
    "Lance claude dans le dossier du dépôt du projet pour y rattacher la session, ou rattache-la à un projet ici.",
  "Attach to project": "Rattacher au projet",
  "Project for {session}": "Projet pour {session}",
  "Choose a project…": "Choisis un projet…",
  "Choose a project for this session.": "Choisis un projet pour cette session.",
  "No projects yet.": "Aucun projet pour l'instant.",
  "A project appears when a member starts a session with codetgh start in a team repository, or runs this command there:":
    "Un projet apparaît quand un membre lance une session avec codetgh start dans un dépôt de l'équipe, ou y lance cette commande\u00a0:",
  // Delegations.
  "a former member": "un ancien membre",
  "Turn off delegation for {session}?": "Couper la délégation de {session}\u202f?",
  "Turn off delegation for {session}…": "Couper la délégation de {session}…",
  "It stops taking requests at once, and the requests it hasn't finished expire. The session keeps running; only a new codetgh start --accept-requests-from delegates it again.":
    "Elle cesse aussitôt de prendre des demandes, et celles qu'elle n'a pas finies expirent. La session continue\u202f; seul un nouveau codetgh start --accept-requests-from la rend de nouveau déléguée.",
  "Delegation of {session} turned off.": "Délégation de {session} coupée.",
  "No delegate sessions.": "Aucune session déléguée.",
  "A delegate session does the tasks that the teammates you name send it, without a human, on its project only. Start one in the project's repository:":
    "Une session déléguée fait les tâches que lui envoient les coéquipiers que tu nommes, sans humain, sur son seul projet. Lance-en une dans le dépôt du projet\u00a0:",
  // A refused action, in the reader's words (routes.tsx READER).
  "This agent is no longer on the hub. Reload the page to see the current list.":
    "Cet agent n'est plus sur le hub. Recharge la page pour voir la liste à jour.",
  "This session no longer takes requests. Reload the page to see the current list.":
    "Cette session ne prend plus de demandes. Recharge la page pour voir la liste à jour.",
  "This project is no longer on the hub. Reload the page to see the current list.":
    "Ce projet n'est plus sur le hub. Recharge la page pour voir la liste à jour.",
  "Give the external agent a name.": "Donne un nom à l'agent externe.",
  "Adding an external agent needs a sign-in from the last 10\u00a0minutes. Sign in again at /login, then add it.":
    "Ajouter un agent externe demande une connexion de moins de 10\u00a0minutes. Reconnecte-toi sur /login, puis ajoute-le.",
  // ---- End of batch 4. ----

  // ---- Batch 5, members, tokens, My data and settings (refonte/membres-reglages). Only that batch edits this block. ----
  // ---- End of batch 5. ----

  // ---- Batch 6, audit, memory, claims and tasks (refonte/audit-memoire). Only that batch edits this block. ----
  // ---- End of batch 6. ----
};

export const t = (lang: Lang, s: string) => (lang === "fr" && Object.hasOwn(FR, s) ? (FR[s] ?? s) : s);
