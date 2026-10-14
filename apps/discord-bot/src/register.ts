import { COMMANDS } from "./bot.js";

// One-off: registers the slash commands with Discord. Run where DISCORD_BOT_TOKEN is set (never in a chat or a file in Git).
const app = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!app || !token) throw new Error("set DISCORD_APP_ID and DISCORD_BOT_TOKEN in the environment first");
const res = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify(COMMANDS),
});
console.log(res.ok ? `registered ${COMMANDS.length} commands` : `Discord refused: HTTP ${res.status} ${await res.text()}`);
if (!res.ok) process.exitCode = 1;
