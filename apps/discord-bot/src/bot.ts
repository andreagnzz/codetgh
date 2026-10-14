import { createPublicKey, verify } from "node:crypto";

// CodeTgh's community bot: Discord HTTP interactions, no gateway and no library. Every request is checked against
// Discord's Ed25519 signature before anything else; the answers are fixed text plus the CI state of main.
type Headers = Record<string, string | undefined>;
type Reply = { status: number; body: unknown };

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export function createBot(opts: { publicKey: string; repo: string; ciStatus: () => Promise<string> }) {
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(opts.publicKey, "hex")]), format: "der", type: "spki" });
  const repoUrl = `https://github.com/${opts.repo}`;
  const say = (content: string): Reply => ({ status: 200, body: { type: 4, data: { content, allowed_mentions: { parse: [] } } } });
  const answers: Record<string, () => Promise<Reply> | Reply> = {
    install: () =>
      say(
        "Join a team in three lines (your admin gives you the hub address):\n```\nnpm install -g https://<your-hub>/cli/codetgh.tgz\ncodetgh setup\ncodetgh doctor\n```",
      ),
    docs: () =>
      say(`README: ${repoUrl}\nHosting a hub: ${repoUrl}/blob/main/docs/DEPLOY.md\nclaude.ai: ${repoUrl}/blob/main/docs/claude-ai.md`),
    bug: () => say(`Report a bug (fake data only, never a token): ${repoUrl}/issues/new/choose`),
    security: () => say(`Found a vulnerability? Report it privately, not here: ${repoUrl}/security/advisories/new`),
    status: async () => say(await opts.ciStatus()),
  };

  return {
    async handle(rawBody: string, headers: Headers): Promise<Reply> {
      const signature = headers["x-signature-ed25519"] ?? "";
      const timestamp = headers["x-signature-timestamp"] ?? "";
      const valid = /^[0-9a-f]{128}$/.test(signature) && verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
      if (!valid) return { status: 401, body: { error: "invalid request signature" } };
      const interaction = JSON.parse(rawBody) as { type: number; data?: { name?: string } };
      if (interaction.type === 1) return { status: 200, body: { type: 1 } };
      const answer = answers[interaction.data?.name ?? ""];
      return answer ? answer() : say("Unknown command. Try /install, /docs, /status, /bug or /security.");
    },
  };
}

// The commands as Discord registers them (register.ts).
export const COMMANDS = [
  { name: "install", description: "How to install CodeTgh and join a team" },
  { name: "docs", description: "Where the documentation is" },
  { name: "status", description: "The CI state of the main branch" },
  { name: "bug", description: "Report a bug" },
  { name: "security", description: "Report a vulnerability privately" },
];
