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
  // Threads.
  "Threads with a message in the last day, or with a message someone hasn't read yet.":
    "Les fils avec un message dans la dernière journée, ou avec un message que quelqu'un n'a pas encore lu.",
  "A thread moves here after a day without messages, once every message in it is read.":
    "Un fil arrive ici après une journée sans message, une fois tous ses messages lus.",
  People: "Personnes",
  "Team thread": "Fil d'équipe",
  "Direct thread": "Fil direct",
  "Direct thread with {people}": "Fil direct avec {people}",
  "Team thread from {people}": "Fil d'équipe lancé par {people}",
  "+{n} more": "+{n}\u00a0autres",
  "You're not in it. Opening it is recorded in the audit log.": "Tu n'y participes pas. L'ouvrir l'inscrit au journal d'audit.",
  "Not shown": "Non affichées",
  "Muted by a person": "En sourdine par une personne",
  "Muted by the loop guard": "En sourdine par le garde-fou des boucles",
  "{n}\u00a0of\u00a0{max}": "{n}\u00a0sur\u00a0{max}",
  "Agent streak {n}\u00a0of\u00a0{max}": "Série d'agents\u00a0: {n}\u00a0sur\u00a0{max}",
  "Earlier threads": "Fils plus anciens",
  "End-to-end encrypted": "Chiffré de bout en bout",
  "No threads yet.": "Aucun fil pour l'instant.",
  "A thread starts with the first message an agent or a person sends.":
    "Un fil commence au premier message envoyé par un agent ou une personne.",
  "No threads in {project}.": "Aucun fil dans {project}.",
  "No threads outside a project.": "Aucun fil hors projet.",
  "A thread joins a project when an agent working in its repository writes.":
    "Un fil rejoint un projet quand un agent qui travaille dans son dépôt y écrit.",
  "Show all projects": "Voir tous les projets",
  // A thread.
  "This thread doesn't exist.": "Ce fil n'existe pas.",
  "Check the link, or find the thread in the list.": "Vérifie le lien, ou retrouve le fil dans la liste.",
  "About this thread": "À propos de ce fil",
  "First message": "Premier message",
  "Mute thread": "Mettre le fil en sourdine",
  "Reopen thread": "Rouvrir le fil",
  "Left to right: {names}": "De gauche à droite\u00a0: {names}",
  agent: "agent",
  person: "personne",
  "Low priority": "Priorité basse",
  "High priority": "Priorité haute",
  Blocking: "Bloquant",
  "Looks like an instruction": "Ressemble à une consigne",
  "The hub flagged this text. It's shown here, never run.": "Le hub a signalé ce texte. Il est affiché ici, jamais exécuté.",
  "May hold a secret": "Contient peut-être un secret",
  "Don't copy it anywhere before checking it.": "Ne le copie nulle part avant de l'avoir vérifié.",
  "Links to another site": "Renvoie vers un autre site",
  "Check where a link leads before you open it.": "Vérifie où mène un lien avant de l'ouvrir.",
  "Read it in a participant's terminal with codetgh inbox.": "Lis-le dans le terminal d'un participant avec codetgh inbox.",
  "End-to-end encrypted. Read it in a participant's terminal with codetgh inbox.":
    "Chiffré de bout en bout. Lis-le dans le terminal d'un participant avec codetgh inbox.",
  "The console can't write into this thread: reply from your terminal, where codetgh encrypts for every participant.":
    "La console ne peut pas écrire dans ce fil\u00a0: réponds depuis ton terminal, où codetgh chiffre pour chaque participant.",
  "Older messages": "Messages précédents",
  "Latest messages": "Derniers messages",
  "No messages here yet.": "Aucun message ici pour l'instant.",
  "Messages you send or receive in this thread appear here.": "Les messages que tu envoies ou reçois dans ce fil apparaissent ici.",
  "You're reading a direct thread as an admin.": "Tu lis un fil direct en tant qu'admin.",
  "This opening is recorded in the audit log, and the page doesn't refresh on its own.":
    "Cette ouverture est inscrite au journal d'audit, et la page ne se met pas à jour toute seule.",
  "The loop guard muted this thread.": "Le garde-fou des boucles a mis ce fil en sourdine.",
  "Agents wrote {max} messages in a row. Reply as a person, or reopen the thread, so agents can write again.":
    "Les agents ont écrit {max}\u00a0messages d'affilée. Réponds en personne, ou rouvre le fil, pour que les agents puissent écrire à nouveau.",
  "Reply to the thread": "Répondre dans le fil",
  "Sent as you. A reply from a person resets the agent streak and reopens a muted thread.":
    "Envoyé en ton nom. Une réponse d'une personne remet la série d'agents à zéro et rouvre un fil en sourdine.",
  "Send reply": "Envoyer la réponse",
  "Reload the page": "Recharger la page",
  // Alerts.
  "What the hub flagged or stopped, newest first. Decide on each open alert: dismiss it once handled, or mark it a false positive.":
    "Ce que le hub a signalé ou arrêté, du plus récent au plus ancien. Décide pour chaque alerte ouverte\u00a0: ignore-la une fois traitée, ou marque-la comme faux positif.",
  Alert: "Alerte",
  From: "De",
  Raised: "Levée",
  "Secret blocked": "Secret bloqué",
  "Agent loop": "Boucle d'agents",
  "Loop waiting for a person": "Boucle en attente d'une personne",
  "Audit log tampered with": "Journal d'audit altéré",
  "The hub refused the message: the secret was never stored.": "Le hub a refusé le message\u00a0: le secret n'a jamais été enregistré.",
  "The loop guard muted the thread after {max} agent messages in a row.":
    "Le garde-fou des boucles a mis le fil en sourdine après {max}\u00a0messages d'agents d'affilée.",
  "The loop orchestrator already reopened this thread once: a person decides now.":
    "L'orchestrateur de boucles a déjà rouvert ce fil une fois\u00a0: une personne décide maintenant.",
  "The hub": "Le hub",
  Nobody: "Personne",
  Open: "Ouverte",
  Dismissed: "Ignorée",
  Decided: "Décidée",
  "Fingerprint allowed": "Empreinte autorisée",
  "More decisions on this alert: {alert}, {from}": "Autres décisions sur cette alerte\u00a0: {alert}, {from}",
  "Dismiss: {alert}, {from}": "Ignorer\u00a0: {alert}, {from}",
  "Open thread: {alert}, {from}": "Ouvrir le fil\u00a0: {alert}, {from}",
  "Allow this secret's fingerprint?": "Autoriser l'empreinte de ce secret\u202f?",
  "Messages that carry this exact secret then pass the hub's check. Other secrets are still refused.":
    "Les messages qui contiennent exactement ce secret passeront alors le contrôle du hub. Les autres secrets restent refusés.",
  "Quarantine {name}'s sessions?": "Mettre les sessions de {name} en quarantaine\u202f?",
  "Every session of this person can then send only notes, questions and answers: no claims, tasks, requests, handoffs or memory. Only an admin lifts it.":
    "Les sessions de cette personne ne pourront plus envoyer que des notes, des questions et des réponses\u00a0: ni réservation, ni tâche, ni demande, ni relais, ni mémoire. Seul un admin lève la quarantaine.",
  "No alerts.": "Aucune alerte.",
  "Messages that look like instructions, or that carry a secret, show up here for an admin to decide.":
    "Les messages qui ressemblent à des consignes, ou qui contiennent un secret, arrivent ici pour qu'un admin décide.",
  // ---- End of batch 3. ----

  // ---- Batch 4, agents, projects and delegations (refonte/agents-projets). Only that batch edits this block. ----
  // ---- End of batch 4. ----

  // ---- Batch 5, members, tokens, My data and settings (refonte/membres-reglages). Only that batch edits this block. ----
  // ---- End of batch 5. ----

  // ---- Batch 6, audit, memory, claims and tasks (refonte/audit-memoire). Only that batch edits this block. ----
  // ---- End of batch 6. ----
};

export const t = (lang: Lang, s: string) => (lang === "fr" && Object.hasOwn(FR, s) ? (FR[s] ?? s) : s);
