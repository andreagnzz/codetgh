---
name: handoff
description: Prepare a CodeTgh handoff for a teammate, show it to the user, and send it once approved.
argument-hint: "@handle [task id]"
disable-model-invocation: true
---

The user wants to hand work over: `$ARGUMENTS`

1. The first word is the recipient (`@handle`); an optional `tsk_…` id names the task to hand over (it is reassigned to the recipient). If the recipient is missing, ask.
2. Fill the capsule from this session's work:
   - `summary` (1 200 characters at most), `done`, `todo`;
   - `files_touched` with relative paths and `change`;
   - `decisions`: only accepted team memory ids, found with `memory_search`;
   - `open_questions`, `commands` to run, `warnings`;
   - `branch` and `last_commit` (`git rev-parse --short HEAD`).
3. Never include keys, tokens, passwords or `.env` content. Point to files instead of pasting them.
4. Show the whole capsule to the user and wait for an explicit go. Then call `handoff` (`mcp__plugin_codetgh_hub__handoff`).
5. Report the message id and, if a task was handed over, its new assignee.
