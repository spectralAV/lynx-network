# Roadmap To 1.0.0

| Milestone | Status | Key Deliverables |
| --- | --- | --- |
| **`0.1.x` (Alpha)** | **Current (`v0.1.0-alpha.1`)** | • Bitfocus Companion v3 TypeScript scaffold (`@companion-module/base`)<br>• Sound Devices Astral (A20-Nexus / ARX32) WebSocket JSON telemetry driver<br>• Single-socket DiGiCo S21 UDP OSC proxy broker (`:8000` / `:8001`)<br>• Restricted-slice scribble-strip naming & S21 color index mapping (`2`, `5`, `6`)<br>• Dual-Mode Panic Switch (`activePanicTarget` Mode A Comms PTT / Mode B PA Mute + Tech Matrix 1)<br>• Stream Deck + XL top grid feedbacks, LCD touch strip variables, and 4x Rotary Encoder presets<br>• Standalone `mock-hardware-stage.js` simulator & automated CI suite |
| **`0.2.x` (Beta 1)** | Planned | • Bidirectional S21 console state polling and snapshot sync on startup<br>• Per-tablet Aux Send ACL filtering so stage tablets can only modify their assigned IEM bus<br>• Hardware bench validation with physical Sound Devices A20-Nexus and DiGiCo S21 |
| **`0.5.x` (Beta 2)** | Planned | • Full hardware validation for Shure Axient Digital (`AD4D` / `AD4Q` ShowLink) and Sennheiser Digital 6000 (`EM 6000` SSC)<br>• Multi-pedal MIDI CC / USB HID direct listener option |
| **`1.0.0` (Production)** | Planned | • Official Bitfocus Companion module store submission<br>• Redundant Astral receiver failover support and full touring showfile templates |

