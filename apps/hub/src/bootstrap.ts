import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { createInvitation, createTeam } from "./domain/teams.js";

// Creates a team and prints the owner's invitation link (valid 7 days). Sign-up is invitation-only.
const { values } = parseArgs({ options: { team: { type: "string" }, email: { type: "string" } } });
if (!values.team || !values.email)
  throw new Error('usage: pnpm --filter @codetgh/hub bootstrap --team "Acme web" --email owner@example.com');
const config = loadConfig();
const { db, close } = await openDb(config);
const teamId = await createTeam(db, values.team);
const { token } = await createInvitation(db, { teamId, email: values.email, role: "owner", invitedBy: null, via: "system" });
console.log(`Team ${values.team} created. Owner invitation for ${values.email}:\n${config.publicUrl}/invite/${token}`);
await close();
