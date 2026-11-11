# Security Policy

`companion-module-digico-astral-orchestrator` is a local-network show-control broker for live production environments. Security reports are welcome, especially around UDP OSC proxy packet handling, WebSocket/TCP telemetry ingestion, denial-of-service resilience on stage networks, and dependency vulnerabilities.

## Supported Versions

| Version | Security support |
| --- | --- |
| `0.1.x` | Best-effort public alpha support |
| Earlier versions | Not supported |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting if it is available for this repository. If private reporting is unavailable, open a public issue that only asks for a security contact and does not include exploit details.

Please include:

- Affected version or commit.
- Operating system and Bitfocus Companion / Node.js version.
- Reproduction steps or crafted packet example.
- Impact and affected component (`src/osc.ts`, `src/wireless.ts`, `src/main.ts`).

Do not post private venue network configurations, credentials, or active exploit payloads in public issues.

## Scope

In scope:

- Malformed OSC 1.0 packet or WebSocket frame handling that could crash the Companion module process during a live show.
- Unauthorized command injection through the multi-client UDP proxy listener.
- Dependency or packaging vulnerabilities.

Out of scope:

- Unencrypted UDP OSC or Telnet protocols inherent to third-party mixing consoles and wireless receivers on an isolated production VLAN.
- Issues requiring physical access to an unlocked FOH control surface.

