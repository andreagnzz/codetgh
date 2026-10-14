---
name: ask
description: Ask a teammate a question through CodeTgh and wait briefly for the answer.
argument-hint: "@handle question"
disable-model-invocation: true
---

The user wants to ask a teammate: `$ARGUMENTS`

1. The first word is the recipient (`@handle`); the rest is the question. If the recipient is missing, ask the user who should receive it.
2. Never include keys, tokens, passwords or `.env` content. Refer to files by relative path and revision (`git rev-parse --short HEAD`).
3. Call `ask_peer` (`mcp__plugin_codetgh_hub__ask_peer`) with `wait_s: 45`.
4. If the answer arrives, show it to the user as a quote from the teammate. If the result is `pending`, tell the user and carry on: the answer will arrive with the next prompt or `inbox_read`.
