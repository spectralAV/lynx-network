# Contributing To Lynx Network

Thanks for helping make **Lynx Network** (`lynx-network`) better. This project is currently in public alpha with full hardware stage simulation, so the most useful contributions are focused, reproducible, and easy to verify against `mock-hardware-stage.js` or physical stage consoles.

## Development Setup

Install dependencies:

```powershell
npm install
```

Build the TypeScript module:

```powershell
npm run build
```

Run automated unit and end-to-end stage simulator checks before opening a pull request:

```powershell
npm test
node mock-hardware-stage.js --demo
```

Start the standalone Alpha State Stage Simulator for live Bitfocus Companion attachment:

```powershell
npm run sim
```

## Contribution Workflow

1. Open or find an issue that describes the problem or hardware feature.
2. Keep changes scoped to one topic (e.g., wireless telemetry driver, S21 OSC proxy, Mixing Station relay, or Stream Deck + presets).
3. Prefer existing patterns in `src/wireless.ts`, `src/osc.ts`, `src/main.ts`, and `src/actions.ts`.
4. Add or update tests in `src/__tests__/orchestrator.test.ts` when behavior changes.
5. Update documentation under `docs/` and `README.md` when setup, OSC paths, or user-facing behavior changes.
6. Open a pull request with a clear summary and verification notes.

## Code Style

- TypeScript (`strict: true`) is used for the Bitfocus Companion module, wireless drivers, and OSC broker.
- Keep wireless receiver protocol parsing encapsulated inside `WirelessTelemetryDriver` subclasses in `src/wireless.ts`.
- Keep binary OSC 1.0 packet encoding/decoding and UDP socket multiplexing inside `src/osc.ts`.
- Keep show-critical Dual-Mode Panic Switch logic (`activePanicTarget`, Mode A Comms PTT, Mode B PA Mute + Tech Matrix 1 Unmute) deterministic and covered by automated tests.

## Pull Request Checklist

- [ ] The change has a clear user, audio engineer, or maintainer benefit.
- [ ] `npm run build` passes with zero TypeScript errors.
- [ ] `npm test` passes.
- [ ] `node mock-hardware-stage.js --demo` completes cleanly.
- [ ] Docs are updated when behavior, OSC addresses, or configuration fields change.
- [ ] No private network credentials, tokens, or proprietary firmware files are included.
