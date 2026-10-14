import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { createMailer } from "./mailer.js";

const config = loadConfig();
const { db } = await openDb(config);
const mailer = createMailer(config.smtpUrl, config.mailFrom);
const auth = createAuth(config, db, mailer);
serve({ fetch: createApp({ config, db, auth, mailer }).fetch, port: config.port }, () => {
  console.log(`CodeTgh hub on ${config.publicUrl} (port ${config.port})`);
});
