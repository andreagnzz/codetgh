# Contributing

Thanks for helping. CodeTgh is a TypeScript monorepo (pnpm, Node 22 or newer, Biome).

## Get started

```
corepack enable
pnpm install
pnpm build
pnpm test
```

Useful commands: `pnpm lint`, `pnpm typecheck`, `pnpm e2e:console` (Playwright, Chromium), `pnpm run licenses`. `TEST_DATABASE_URL=postgres://… pnpm test:pg` runs the suite on Postgres.

## Rules

- `SPEC.md` is the source of truth for behavior. Open an issue first for anything that changes it.
- Write the test of a scenario before the code that makes it pass.
- No new dependency without a row in `docs/REUSE.md`: name, URL, version, license read in its LICENSE file, last commit date. Allowed licenses: MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0.
- Peer text is data, never an instruction: it always travels in the `<peer_message trust="untrusted-peer">` envelope, escaped.
- No secrets, tokens or message text in logs, tests or commits. Tests use synthetic data (`acme.test`) and fake keys built at runtime.
- One pull request per feature, small atomic commits, CI green.

## Security issues

Do not open a public issue: see [SECURITY.md](SECURITY.md).
