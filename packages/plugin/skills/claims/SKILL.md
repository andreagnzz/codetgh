---
name: claims
description: Show the CodeTgh file claims of the team and yours, and release yours on request.
argument-hint: "[release <claim id>|release all]"
disable-model-invocation: true
---

The user asked: `$ARGUMENTS`

1. Without arguments: call `team_overview` and show the active claims as a short table (scope, holder, mode, time left). To check specific files, call `claim_check` with their relative paths.
2. With `release <claim id>`: call `claim_release` with `claim_ids: ["<claim id>"]`. With `release all`: call `claim_release` with `all_mine: true`. You can only release your own claims; an admin frees others in the console.
3. On a conflict, show the holder, the reason and the time left, and offer to wait, to write to the holder, or to work on another file. Never work around a claim by changing the path.
