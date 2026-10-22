# The image runner agents run in with "isolation": "docker" (docs/DEPLOY.md, Runner). Built with no context by
# codetgh runner build-image, tagged codetgh-runner-agent:<plugin version>. No gh, no SSH keys, no credential: the runner
# passes the Claude one by name at each run (--env), and mounts the worktree at /work.
FROM node:24.21.0-bookworm-slim
ARG CLAUDE_CODE_VERSION=2.1.307
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
# Pinned through npm, as code.claude.com/docs/en/devcontainer says for reproducible builds, with auto-update off.
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
RUN useradd --uid 10001 --no-create-home --home-dir /tmp --shell /bin/sh agent
# The root filesystem is read-only at run time: home and Claude Code's config on the /tmp tmpfs.
ENV HOME=/tmp DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
USER 10001
WORKDIR /work
# Group-writable files, so the runner, in the same group, can still commit and clean what the agent creates.
ENTRYPOINT ["/bin/sh", "-c", "umask 002 && exec \"$@\"", "sh"]
CMD ["claude", "--version"]
