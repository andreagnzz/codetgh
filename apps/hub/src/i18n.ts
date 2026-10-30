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
  "Make owner": "Passer en propriétaire",
  "Make admin": "Passer en admin",
  "Make member": "Passer en membre",
  "Make guest": "Passer en invité",
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
  // Sign-in
  "Use the account your team set up on this hub.": "Utilise le compte que ton équipe a créé sur ce hub.",
  "Continue with GitHub": "Continuer avec GitHub",
  "Continue with Google": "Continuer avec Google",
  "Continue with your organization": "Continuer avec ton organisation",
  or: "ou",
  "Get a sign-in link by email instead": "Recevoir plutôt un lien par courriel",
  "Email for the link": "Courriel pour le lien",
  "The email or password is wrong. Check both, then try again.":
    "Le courriel ou le mot de passe est incorrect. Vérifie les deux, puis réessaie.",
  "This email address isn't valid. Enter an address like name@example.com.":
    "Cette adresse de courriel n'est pas valable. Saisis une adresse comme nom@exemple.com.",
  "This sign-in method isn't available on this hub. Use another one.":
    "Ce moyen de connexion n'est pas disponible sur ce hub. Utilises-en un autre.",
  "If this address has an account or an invitation, a sign-in link is on its way. It works for 10\u00a0minutes.":
    "Si cette adresse a un compte ou une invitation, un lien de connexion est en route. Il reste valable 10\u00a0minutes.",
  "The link wasn't sent. Check the address, then try again.": "Le lien n'est pas parti. Vérifie l'adresse, puis réessaie.",
  "The hub could not handle the request. Try again; if it keeps failing, check the hub logs.":
    "Le hub n'a pas pu traiter la demande. Réessaie\u202f; si ça continue, regarde les journaux du hub.",
  "The hub does not answer. Check your connection, then try again.": "Le hub ne répond pas. Vérifie ta connexion, puis réessaie.",
  "Too many tries. Wait a few seconds, then try again.": "Trop d'essais. Attends quelques secondes, puis réessaie.",
  // OAuth consent
  "Allow access to your account?": "Autoriser l'accès à ton compte\u202f?",
  "An app asks to use this hub as you. Allow it only if you just connected it yourself.":
    "Une application demande à utiliser ce hub en ton nom. Autorise-la seulement si tu viens de la connecter toi-même.",
  "Asked by": "Demandé par",
  "Access asked for": "Accès demandé",
  "Then you go back to": "Ensuite, retour vers",
  "Use this hub as you, with your role: messages, claims, tasks and team memory":
    "Utiliser ce hub en ton nom, avec ton rôle\u00a0: messages, réservations, tâches et mémoire d'équipe",
  "Know who you are": "Savoir qui tu es",
  "See your name": "Voir ton nom",
  "See your email address": "Voir ton adresse de courriel",
  "Keep its access without asking you again": "Garder son accès sans te redemander",
  "Not described by this hub": "Non décrit par ce hub",
  "Nothing beyond your sign-in": "Rien de plus que ta connexion",
  "This request has expired or was changed. Start again from your app.":
    "Cette demande a expiré ou a été modifiée. Recommence depuis ton application.",
  // Invitation
  "You're invited as an owner.": "Tu rejoindras l'équipe comme propriétaire.",
  "You're invited as an admin.": "Tu rejoindras l'équipe comme admin.",
  "You're invited as a member.": "Tu rejoindras l'équipe comme membre.",
  "You're invited as a guest. A guest sees only the threads they take part in.":
    "Tu rejoindras l'équipe comme invité. Un invité ne voit que les fils auxquels il participe.",
  "Your account uses the address the invitation was sent to.": "Ton compte utilise l'adresse à laquelle l'invitation a été envoyée.",
  "At least 12 characters.": "Au moins 12\u00a0caractères.",
  "An account already uses this address. Sign in, then open this invitation again.":
    "Un compte utilise déjà cette adresse. Connecte-toi, puis rouvre cette invitation.",
  "This invitation can't create an account any more. Ask the person who invited you for a new link.":
    "Cette invitation ne peut plus créer de compte. Demande un nouveau lien à la personne qui t'a invité.",
  "Signed in as": "Compte connecté",
  "It was sent to {email}. You're signed in as {user}.": "Elle a été envoyée à {email}. Compte connecté\u00a0: {user}.",
  // Device
  "When codetgh signs in a terminal, it shows a code. Type that code here, then approve the terminal.":
    "Quand codetgh connecte un terminal, il affiche un code. Tape ce code ici, puis approuve le terminal.",
  "8 letters, like BCDF-GHJK. Capitals and the dash are optional.": "8\u00a0lettres, comme BCDF-GHJK. Majuscules et tiret facultatifs.",
  "Check this sign-in": "Vérifie cette connexion",
  Code: "Code",
  "Sent by the terminal. Anyone can send any name, so compare the code, not the name.":
    "Envoyé par le terminal. N'importe qui peut envoyer n'importe quel nom\u00a0: compare le code, pas le nom.",
  "Terminal approved": "Terminal approuvé",
  "Go back to your terminal: it finishes on its own.": "Retourne dans ton terminal\u00a0: il termine tout seul.",
  "Sign-in denied": "Connexion refusée",
  "No token was created.": "Aucun jeton n'a été créé.",
  "This code is unknown or has expired. Check the code in your terminal, or run codetgh login again.":
    "Ce code est inconnu ou a expiré. Vérifie le code dans ton terminal, ou relance codetgh login.",
  "Too many wrong codes. Wait a few minutes, then type the code again.":
    "Trop de codes erronés. Attends quelques minutes, puis tape le code à nouveau.",
  // ---- End of batch 1. ----

  // ---- Batch 2, overview and live feed (refonte/vue-ensemble). Only that batch edits this block. ----
  // What needs a person.
  "Needs you": "À traiter",
  "Nothing needs you right now.": "Rien à traiter pour l'instant.",
  "1\u00a0open alert.": "1\u00a0alerte ouverte.",
  "{n}\u00a0open alerts.": "{n}\u00a0alertes ouvertes.",
  "Newest:": "La plus récente\u00a0:",
  "looks like an instruction": "ressemble à une consigne",
  "secret blocked": "secret bloqué",
  "agent loop": "boucle d'agents",
  "loop waiting for a person": "boucle en attente d'une personne",
  "audit log tampered with": "journal d'audit altéré",
  "1\u00a0memory proposal waits for a decision.": "1\u00a0proposition de mémoire attend une décision.",
  "{n}\u00a0memory proposals wait for a decision.": "{n}\u00a0propositions de mémoire attendent une décision.",
  "Review memory": "Voir la mémoire",
  "1\u00a0invitation not accepted yet.": "1\u00a0invitation pas encore acceptée.",
  "{n}\u00a0invitations not accepted yet.": "{n}\u00a0invitations pas encore acceptées.",
  "Open members": "Voir les membres",
  "1\u00a0thread muted by the loop guard.": "1\u00a0fil mis en sourdine par le garde-fou des boucles.",
  "{n}\u00a0threads muted by the loop guard.": "{n}\u00a0fils mis en sourdine par le garde-fou des boucles.",
  "Open threads": "Ouvrir les fils",
  // The line.
  "Last 24\u00a0h": "Dernières 24\u00a0h",
  "No messages in the last 24 hours. Older ones are on the threads page.":
    "Aucun message ces dernières 24\u00a0heures. Les plus anciens sont sur la page des fils.",
  "See all threads": "Voir tous les fils",
  "Lanes: {names}": "Couloirs\u00a0: {names}",
  // French has no possessive that suits every name ("de Sam", "d'Alexandre"): the agent follows the name.
  "{name}'s agent": "{name} · agent",
  "the team": "l'équipe",
  "low priority": "priorité basse",
  "high priority": "priorité haute",
  blocking: "bloquant",
  // Presence.
  "1\u00a0online": "1\u00a0en ligne",
  "{n}\u00a0online": "{n}\u00a0en ligne",
  "1\u00a0offline": "1\u00a0hors ligne",
  "{n}\u00a0offline": "{n}\u00a0hors ligne",
  Online: "En ligne",
  Idle: "Inactif",
  External: "Externe",
  "Prompts off": "Sans confirmation",
  Quarantined: "En quarantaine",
  "See all agents": "Voir tous les agents",
  "No agent connected right now.": "Aucun agent connecté pour l'instant.",
  "No agent connected. Copy the invitation command to add one.": "Aucun agent connecté. Copie la commande d'invitation pour en ajouter un.",
  "No agent connected yet. Set up CodeTgh, then start it in the team's repository.":
    "Aucun agent connecté pour l'instant. Installe CodeTgh, puis lance-le dans le dépôt de l'équipe.",
  "Copy the setup command": "Copier la commande d'installation",
  "Copy the start command": "Copier la commande de démarrage",
  // Agent traffic.
  "Agent traffic": "Trafic des agents",
  "Flowing.": "Le trafic circule.",
  "Stopping it refuses every agent message and claim, for the whole team, until an admin resumes it.":
    "Le couper refuse tout message et toute réservation d'agent, pour toute l'équipe, jusqu'à ce qu'un admin le rétablisse.",
  "Stopped.": "Coupé.",
  "Agents can't send messages or claim files until you resume agent traffic.":
    "Les agents ne peuvent plus envoyer de messages ni réserver de fichiers tant que tu n'as pas rétabli le trafic.",
  // A live refresh that failed.
  Retry: "Réessayer",
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
  "People not shown": "Personnes non affichées",
  "Muted by a person": "Mis en sourdine par une personne",
  "Muted by the loop guard": "Mis en sourdine par le garde-fou des boucles",
  "Agent streak {n}\u00a0of\u00a0{max}": "Série d'agents\u00a0: {n}\u00a0sur\u00a0{max}",
  "Earlier threads": "Fils plus anciens",
  "Threads in {project}": "Fils dans {project}",
  "Earlier threads in {project}": "Fils plus anciens dans {project}",
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
  "Nobody yet": "Personne pour l'instant",
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
  "The console can't write into this thread.": "La console ne peut pas écrire dans ce fil.",
  "Reply from your terminal: codetgh encrypts the reply for every participant.":
    "Réponds depuis ton terminal\u00a0: codetgh chiffre la réponse pour chaque participant.",
  "Older messages": "Messages précédents",
  "Latest messages": "Derniers messages",
  "No messages here yet.": "Aucun message ici pour l'instant.",
  "Messages you send or receive in this thread appear here.": "Les messages que tu envoies ou reçois dans ce fil apparaissent ici.",
  "You're reading a direct thread as an admin.": "Tu lis un fil direct en tant qu'admin.",
  "This opening is recorded in the audit log, and the page doesn't refresh on its own.":
    "Cette ouverture est inscrite au journal d'audit, et la page ne se met pas à jour toute seule.",
  "The loop guard muted this thread.": "Le garde-fou des boucles a mis ce fil en sourdine.",
  "Agents wrote {max} messages in a row. Reply as a person, or reopen the thread, so agents can write again.":
    "Les agents ont écrit {max}\u00a0messages d'affilée. Réponds toi-même, ou rouvre le fil, pour que les agents puissent écrire à nouveau.",
  "Agents wrote {max} messages in a row. Reply as a person so agents can write again.":
    "Les agents ont écrit {max}\u00a0messages d'affilée. Réponds toi-même pour que les agents puissent écrire à nouveau.",
  "Agents wrote {max} messages in a row. Reopen the thread so agents can write again.":
    "Les agents ont écrit {max}\u00a0messages d'affilée. Rouvre le fil pour que les agents puissent écrire à nouveau.",
  "Reply to the thread": "Répondre dans le fil",
  "Sent as you. A reply from a person resets the agent streak and reopens a muted thread.":
    "Envoyé en ton nom. Une réponse d'une personne remet la série d'agents à zéro et rouvre un fil en sourdine.",
  "Send reply": "Envoyer la réponse",
  "Reload the page": "Recharger la page",
  // Alerts.
  "What the hub flagged or stopped, newest first. Decide on each open alert: dismiss it once handled, or mark it a false positive.":
    "Ce que le hub a signalé ou arrêté, du plus récent au plus ancien. Décide pour chaque alerte ouverte\u00a0: ignore-la une fois traitée, ou marque-la comme faux positif.",
  Alert: "Alerte",
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
  // An alert's status and decision, in the feminine of « alerte »: a masculine entity (a thread, a task) needs its own key.
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
  // A session, on Agents, Projects and Delegations. Online, Idle, External, Prompts off and Quarantined are batch 2's keys.
  Paused: "En pause",
  // A session, feminine in French: « vue », as « retirée ».
  "Last seen {time}": "Vue {time}",
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
  "See it in External agents": "Le voir parmi les agents externes",
  // Projects.
  "Each team repository and the sessions working in it.": "Chaque dépôt de l'équipe et les sessions qui y travaillent.",
  "Actions for {project}": "Actions pour {project}",
  "Remote Control and the runner start on your machine, only in the folders you listed there.":
    "Remote Control et le runner démarrent sur ta machine, seulement dans les dossiers que tu y as listés.",
  "Remote Control failed": "Remote Control en échec",
  "Runner failed": "Runner en échec",
  "Runner on · 1\u00a0agent running": "Runner en marche · 1\u00a0agent en cours",
  "Runner on · {n}\u00a0agents running": "Runner en marche · {n}\u00a0agents en cours",
  "Start {claude} inside the project's repository folder to link a session, or attach one to a project here.":
    "Lance {claude} dans le dossier du dépôt du projet pour y rattacher la session, ou rattache-la à un projet ici.",
  "Start {claude} inside the project's repository folder to link a session.":
    "Lance {claude} dans le dossier du dépôt du projet pour y rattacher la session.",
  "Attach to project": "Rattacher au projet",
  "Project for {session}": "Projet pour {session}",
  "Choose a project…": "Choisis un projet…",
  "Choose a project for this session.": "Choisis un projet pour cette session.",
  "No projects yet.": "Aucun projet pour l'instant.",
  "A project appears when a member starts a session with {start} in a team repository, or runs this command there:":
    "Un projet apparaît quand un membre lance une session avec {start} dans un dépôt de l'équipe, ou y lance cette commande\u00a0:",
  // Delegations.
  "a former member": "un ancien membre",
  "Turn off delegation for {session}?": "Couper la délégation de {session}\u202f?",
  "Turn off delegation for {session}…": "Couper la délégation de {session}…",
  "It stops taking requests at once, and the requests it hasn't finished expire. The session keeps running; only a new codetgh start that names who may send it requests delegates it again.":
    "Elle cesse aussitôt de prendre des demandes, et celles qu'elle n'a pas finies expirent. La session continue\u202f; seul un nouveau codetgh start qui nomme qui peut lui envoyer des demandes la rend de nouveau déléguée.",
  "Delegation of {session} turned off.": "Délégation de {session} coupée.",
  "No delegate sessions.": "Aucune session déléguée.",
  "Start one in the project's repository, with the handles of the teammates who may send it tasks:":
    "Lance-en une dans le dépôt du projet, avec les pseudos des coéquipiers qui peuvent lui envoyer des tâches\u00a0:",
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
  // Members.
  "Everyone on the team and what each person can do. Invite someone, change a role, or revoke access.":
    "Tout le monde dans l'équipe et ce que chacun peut faire. Invite quelqu'un, change un rôle ou révoque un accès.",
  "Invite a member": "Inviter un membre",
  "name@example.com…": "nom@exemple.com…",
  "Admins also manage members, alerts and settings. Guests see only their own threads.":
    "Les admins gèrent aussi les membres, les alertes et les paramètres. Les invités ne voient que leurs propres fils.",
  Owner: "Propriétaire",
  Admin: "Admin",
  Member: "Membre",
  Guest: "Invité",
  "Valid for": "Valable",
  "From 1 to 30\u00a0days.": "De 1 à 30\u00a0jours.",
  "Invitation emailed to {email}.": "Invitation envoyée par courriel à {email}.",
  "Send this link to {email}.": "Envoie ce lien à {email}.",
  "The link is valid for {days}\u00a0days. You can also send it yourself:":
    "Le lien est valable {days}\u00a0jours. Tu peux aussi l'envoyer toi-même\u00a0:",
  "It's valid for {days}\u00a0days.": "Il est valable {days}\u00a0jours.",
  "Copy the invitation link": "Copier le lien d'invitation",
  "This email address isn't valid. Enter the address to invite, like name@example.com.":
    "Cette adresse de courriel n'est pas valable. Saisis l'adresse à inviter, comme nom@exemple.com.",
  "An invitation lasts 1 to 30\u00a0days. Enter a number of days in that range.":
    "Une invitation dure de 1 à 30\u00a0jours. Saisis un nombre de jours dans cet intervalle.",
  "Pending invitations": "Invitations en attente",
  "Revoke the invitation for {email}": "Révoquer l'invitation de {email}",
  "Revoke the invitation for {email}?": "Révoquer l'invitation de {email}\u202f?",
  "Its link stops working at once. You can invite them again later.":
    "Son lien cesse de fonctionner tout de suite. Tu pourras inviter cette personne de nouveau plus tard.",
  "Invitation for {email} revoked.": "Invitation de {email} révoquée.",
  "No pending invitations.": "Aucune invitation en attente.",
  "Use Invite a member, or run this in a terminal:": "Utilise Inviter un membre, ou lance ceci dans un terminal\u00a0:",
  "Copy the invite command": "Copier la commande d'invitation",
  "Team members": "Membres de l'équipe",
  Joined: "Date d'arrivée",
  You: "Toi",
  "External agent": "Agent externe",
  "Slack bridge": "Pont Slack",
  "Actions for {name}": "Actions pour {name}",
  "Lowercase letters, digits and dashes.": "Minuscules, chiffres et tirets.",
  "Make {name} an owner?": "Passer {name} en propriétaire\u202f?",
  "Owners can do everything admins do, and also manage the other owners.":
    "Les propriétaires font tout ce que font les admins, et gèrent aussi les autres propriétaires.",
  "Make {name} an admin?": "Passer {name} en admin\u202f?",
  "Admins manage members, alerts, the audit log and the team's settings.":
    "Les admins gèrent les membres, les alertes, le journal d'audit et les paramètres de l'équipe.",
  "Make {name} a member?": "Passer {name} en membre\u202f?",
  "Members work with agents, threads, tasks, claims and team memory, without managing the team. Their pending invitations are revoked.":
    "Les membres travaillent avec les agents, les fils, les tâches, les réservations et la mémoire d'équipe, sans gérer l'équipe. Les invitations en attente de cette personne sont révoquées.",
  "Make {name} a guest?": "Passer {name} en invité\u202f?",
  "Guests see only the threads they take part in: no projects, tasks, claims or team memory. Their delegate sessions stop taking requests, and their pending invitations are revoked.":
    "Les invités ne voient que les fils auxquels ils participent\u00a0: ni projets, ni tâches, ni réservations, ni mémoire d'équipe. Les sessions déléguées de cette personne cessent de prendre des demandes, et ses invitations en attente sont révoquées.",
  "Revoke access": "Révoquer l'accès",
  "Revoke access for {name}": "Révoquer l'accès de {name}",
  "Revoke {name}'s access?": "Révoquer l'accès de {name}\u202f?",
  "They're signed out at once: their tokens stop working, their sessions end and their claims are released. What they wrote stays with the team.":
    "Sa connexion se ferme tout de suite\u00a0: ses jetons ne marchent plus, ses sessions s'arrêtent et ses réservations sont libérées. Ce que cette personne a écrit reste à l'équipe.",
  "{name}'s access revoked.": "Accès de {name} révoqué.",
  // Personal tokens.
  "Personal tokens": "Jetons personnels",
  "A token lets a terminal or a script act as you on this hub, for 90\u00a0days. Revoke the ones you no longer use.":
    "Un jeton permet à un terminal ou à un script d'agir en ton nom sur ce hub, pendant 90\u00a0jours. Révoque ceux dont tu ne te sers plus.",
  "Create a token": "Créer un jeton",
  "Name the machine or the use, like laptop or ci.": "Nomme la machine ou l'usage, comme portable ou ci.",
  "Token created. Copy it now: you won't see it again.": "Jeton créé. Copie-le maintenant\u00a0: tu ne le reverras plus.",
  "Copy the token": "Copier le jeton",
  "On your machine, sign in with it. Paste the token when the terminal asks for it:":
    "Sur ta machine, connecte-toi avec. Colle le jeton quand le terminal le demande\u00a0:",
  "Copy the sign-in command": "Copier la commande de connexion",
  "Then install the Claude Code plugin. It asks for the hub's address and this token:":
    "Puis installe le plugin Claude Code. Il demande l'adresse du hub et ce jeton\u00a0:",
  "Copy the plugin command": "Copier la commande du plugin",
  Created: "Créé",
  Expired: "Expiré",
  "Revoke the token {label}": "Révoquer le jeton {label}",
  "Revoke the token {label}?": "Révoquer le jeton {label}\u202f?",
  "Terminals and scripts that use it are refused from their next request. Invitations made with it are revoked too.":
    "Les terminaux et les scripts qui l'utilisent sont refusés dès leur prochaine requête. Les invitations faites avec sont révoquées aussi.",
  "Token {label} revoked.": "Jeton {label} révoqué.",
  "No personal tokens yet.": "Aucun jeton personnel pour l'instant.",
  "Create one to sign in a terminal.": "Crées-en un pour connecter un terminal.",
  // My data.
  "What this hub keeps about you, and what you can do with it.": "Ce que ce hub garde sur toi, et ce que tu peux en faire.",
  Profile: "Profil",
  "Your teammates see it next to your handle, {handle}.": "Tes coéquipiers le voient à côté de ton identifiant, {handle}.",
  "A copy of your data": "Une copie de tes données",
  "Your profile, sessions, messages, claims, tasks, team memory and audit events, in one JSON file.":
    "Ton profil, tes sessions, messages, réservations, tâches, ta mémoire d'équipe et tes événements d'audit, dans un seul fichier JSON.",
  "Download my data": "Télécharger mes données",
  "Reply to the team's threads from Slack, as you. A one-time code links your Slack account.":
    "Réponds aux fils de l'équipe depuis Slack, en ton nom. Un code à usage unique relie ton compte Slack.",
  "Link Slack": "Relier Slack",
  "Type this in Slack within 10\u00a0minutes.": "Tape ceci dans Slack d'ici 10\u00a0minutes.",
  "Your replies in CodeTgh threads there then reach the team as you.":
    "Tes réponses aux fils CodeTgh y arrivent alors à l'équipe en ton nom.",
  "Copy the Slack command": "Copier la commande Slack",
  "Erase my data": "Effacer mes données",
  "Your messages, subjects, claim reasons and task notes become [erased], your name becomes Former member, your claims are released, your tasks go back to the team and your access ends. Tasks and team memory you wrote stay with the team; the audit log keeps ids only.":
    "Tes messages, sujets, motifs de réservation et notes de tâche deviennent [erased], ton nom devient Former member, tes réservations sont libérées, tes tâches reviennent à l'équipe et ton accès prend fin. Les tâches et la mémoire d'équipe que tu as écrites restent à l'équipe\u202f; le journal d'audit ne garde que des identifiants.",
  "Type {command} to confirm": "Tape {command} pour confirmer",
  "This can't be undone.": "C'est définitif.",
  "Nothing was erased. Type erase in the box to confirm.": "Rien n'a été effacé. Tape erase dans le champ pour confirmer.",
  // Settings.
  "How agents work on this team, and the bridges to Slack and GitHub.":
    "Comment les agents travaillent dans l'équipe, et les ponts vers Slack et GitHub.",
  Team: "Équipe",
  "Shown in the top bar and in invitations.": "Affiché dans la barre du haut et dans les invitations.",
  "A team name has 1 to 80 characters, not only spaces. Enter a name.":
    "Un nom d'équipe compte de 1 à 80 caractères, pas seulement des espaces. Saisis un nom.",
  "Settings saved.": "Paramètres enregistrés.",
  Messages: "Messages",
  "Ask the person": "Demander à la personne",
  "Claude Code asks before the edit goes through. This is the default.":
    "Claude Code demande avant que la modification ne passe. C'est le réglage par défaut.",
  "Warn the agent, never block": "Prévenir l'agent, sans jamais bloquer",
  "Autonomous sessions (bypassPermissions) can't answer a question: choose this for teams that run them.":
    "Les sessions autonomes (bypassPermissions) ne peuvent pas répondre à une question\u00a0: choisis ceci pour les équipes qui en utilisent.",
  "Members, admins and owners": "Membres, admins et propriétaires",
  "Admins and owners": "Admins et propriétaires",
  "Owners only": "Propriétaires seulement",
  "Accept team memory from Claude Code too": "Accepter aussi la mémoire d'équipe depuis Claude Code",
  "Claude Code then asks the person each time. claude.ai and the Agent SDK can't guarantee that.":
    "Claude Code demande alors à la personne à chaque fois. claude.ai et l'Agent SDK ne peuvent pas le garantir.",
  "Link a new repository when a member starts a session in it": "Lier un nouveau dépôt quand un membre y ouvre une session",
  "Otherwise an admin runs {command}.": "Sinon, un admin lance {command}.",
  "Allow rewake push": "Autoriser le réveil",
  "An idle Claude Code session wakes up when a message arrives. Each member also turns it on in the plugin.":
    "Une session Claude Code inactive se réveille à l'arrivée d'un message. Chaque membre l'active aussi dans le plugin.",
  "Keep messages for": "Garder les messages",
  "Older messages are deleted. Threads, team memory and the audit log stay.":
    "Les messages plus anciens sont supprimés. Les fils, la mémoire d'équipe et le journal d'audit restent.",
  "Extra secret patterns": "Motifs de secrets en plus",
  "One regular expression per line. A message that matches one is blocked, as a known secret is.":
    "Une expression régulière par ligne. Un message qui correspond à l'une d'elles est bloqué, comme un secret connu.",
  "Slack channel": "Canal Slack",
  "The channel that gets alerts and blocking requests. Its id looks like C0123ABC.":
    "Le canal qui reçoit les alertes et les demandes bloquantes. Son identifiant ressemble à C0123ABC.",
  "Loop orchestrator": "Orchestrateur de boucles",
  "The member whose agent judges the agent loops the hub muted. Left empty, a person reopens them.":
    "Le membre dont l'agent juge les boucles d'agents que le hub a mises en sourdine. Vide, une personne les rouvre.",
  "Save settings": "Enregistrer les paramètres",
  "Saves the agent rules, memory, messages and the Slack channel.":
    "Enregistre les règles des agents, la mémoire, les messages et le canal Slack.",
  "Webhook configured": "Webhook configuré",
  "Not configured": "Non configuré",
  "GitHub tells the team about pull requests, check suites and new tags: titles, links and branches, never code.":
    "GitHub informe l'équipe des pull requests, des check suites et des nouveaux tags\u00a0: titres, liens et branches, jamais de code.",
  "Replace the webhook secret?": "Remplacer le secret du webhook\u202f?",
  "GitHub deliveries signed with the old secret are refused until you paste the new one in your GitHub App.":
    "Les envois de GitHub signés avec l'ancien secret sont refusés tant que le nouveau n'est pas collé dans ton application GitHub.",
  "Copy the secret now: you won't see it again.": "Copie le secret maintenant\u00a0: tu ne le reverras plus.",
  "In your GitHub App, under Settings → Webhook, set these two values. Then subscribe to the Pull request, Check suite and Create events.":
    "Dans ton application GitHub, sous Settings → Webhook, saisis ces deux valeurs. Puis abonne-la aux événements Pull request, Check suite et Create.",
  "Webhook URL": "URL du webhook",
  "Copy the webhook URL": "Copier l'URL du webhook",
  "Webhook secret": "Secret du webhook",
  "Copy the secret": "Copier le secret",
  "To check an audit export offline, pass this key to {command}.":
    "Pour vérifier un export d'audit hors ligne, donne cette clé à {command}.",
  "Key id": "Identifiant de clé",
  "Copy the public key": "Copier la clé publique",
  // ---- End of batch 5. ----

  // ---- Batch 6, audit, memory, claims and tasks (refonte/audit-memoire). Only that batch edits this block. ----
  // ---- End of batch 6. ----
};

export const t = (lang: Lang, s: string) => (lang === "fr" && Object.hasOwn(FR, s) ? (FR[s] ?? s) : s);
