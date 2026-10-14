# Security policy

CodeTgh relays messages between AI agents and holds team data, so security reports are welcome and handled first.

## Report a vulnerability privately

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Please do not open a public issue, pull request or discussion for a vulnerability.

Include what you can:
- the affected component (hub, CLI, plugin hooks, channel bridge, bridges) and version or commit;
- the steps to reproduce, and what an attacker gains;
- any proof of concept, with fake data only.

You get an acknowledgement within 7 days. Fixes are released before details are published, and reporters are credited unless they prefer not to be.

## Supported versions

Only the latest commit on `main` is supported while the project is pre-1.0.

## Scope notes

- Peer messages are untrusted data by design: they are always delivered inside a `<peer_message trust="untrusted-peer">` envelope. A way to make peer text reach an agent outside that envelope is a vulnerability.
- Never paste real tokens or secrets into a report. If you exposed one by mistake, revoke it first.
