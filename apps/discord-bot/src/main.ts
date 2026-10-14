import { createServer } from "node:http";
import { createBot } from "./bot.js";

const publicKey = process.env.DISCORD_PUBLIC_KEY;
if (!publicKey) throw new Error("DISCORD_PUBLIC_KEY is required (Developer Portal → General Information → Public Key)");
const repo = process.env.CODETGH_REPO ?? "andreagnzz/codetgh";
const port = Number(process.env.PORT ?? 8790);

// The CI state of main, from GitHub's public API, refreshed at most every 5 minutes (Discord wants an answer within 3 s).
let ci = { text: "CI state not known yet.", at: 0 };
async function ciStatus() {
  if (Date.now() - ci.at > 300_000) {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=1`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    const run = res?.ok
      ? ((await res.json()) as { workflow_runs?: Array<{ conclusion: string | null; status: string; head_sha: string; html_url: string }> })
          .workflow_runs?.[0]
      : undefined;
    if (run) ci = { text: `CI on main: ${run.conclusion ?? run.status} (${run.head_sha.slice(0, 7)}) ${run.html_url}`, at: Date.now() };
  }
  return ci.text;
}

const bot = createBot({ publicKey, repo, ciStatus });
createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/interactions") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > 64 * 1024) req.destroy();
    else chunks.push(c);
  });
  req.on("end", async () => {
    const headers = {
      "x-signature-ed25519": req.headers["x-signature-ed25519"] as string,
      "x-signature-timestamp": req.headers["x-signature-timestamp"] as string,
    };
    const reply = await bot
      .handle(Buffer.concat(chunks).toString("utf8"), headers)
      .catch(() => ({ status: 400, body: { error: "bad request" } }));
    res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
  });
}).listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`discord bot listening on ${port}`));
