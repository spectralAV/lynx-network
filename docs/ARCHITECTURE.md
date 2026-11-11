# Architecture & Protocol Reference

`companion-module-digico-astral-orchestrator` operates as a multi-client, context-aware network broker and tactile state engine between RF receivers, the DiGiCo S21 mixing console, stage IEM tablets, and FOH Stream Deck + XL hardware.

---

## 1. Module Subsystem Map

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Core `InstanceBase` orchestrator, wireless telemetry-to-S21 mapper, Dual-Mode Panic Switch state machine (`activePanicTarget`), and 450ms visual alert flash loop. |
| `src/config.ts` | Companion GUI configuration schema (`GetConfigFields`), JSON Channel-to-Fader parser (`parseChannelMapping`), and Mixing Station endpoint parser. |
| `src/osc.ts` | RFC-compliant OSC 1.0 binary encoder/decoder (`encodeOscMessage`, `decodeOscMessage`) and `DiGiCoOscProxyBroker` single-socket console multiplexer. |
| `src/wireless.ts` | Abstract `WirelessTelemetryDriver` base class plus concrete drivers for **Sound Devices Astral** (`AstralWebSocketDriver`), **Shure Axient Digital** (`ShureAxientTelnetDriver`), and **Sennheiser Digital 6000** (`SennheiserD6000UdpDriver`). |
| `src/actions.ts` | Action definitions and programmatic routers for `setActiveChannel(chan_id)`, `clearArmedChannel()`, `executeSmartPedalStomp(boolean_isPressed)`, and Rotary Dials 1–4. |
| `src/feedbacks.ts` | Stream Deck + XL visual feedbacks (`channelHealthStatus`, `panicModeIndicator`, `pedalStompActive`). |
| `src/variables.ts` | Dynamic variables for the Stream Deck + LCD touch strip (`lcd_strip_headline`, `lcd_strip_nexlink`) and per-channel battery/clip readouts. |
| `src/presets.ts` | Drag-and-drop button and rotary encoder presets (`rotaryActions: true`) for Companion v3. |
| `mock-hardware-stage.js` | Standalone Node.js Alpha State Stage Simulator emulating Astral WebSocket broadcasts, S21 UDP OSC console logging, and Mixing Station tablet listeners. |

---

## 2. Telemetry-to-Console Mapping Pipeline

When a wireless telemetry frame arrives from `AstralWebSocketDriver`:

1. **Channel Lookup**: `rxId` is mapped via `rxToS21Map` to its target DiGiCo S21 input channel (`s21Channel`) and base label (e.g., `VOX1`).
2. **Restricted Scribble-Strip Name Slicing (`formatRestrictedS21Name`)**:
   - Appends the live battery percentage to the base channel tag and slices the base string so the total length never exceeds `maxNameLength` (default `12` characters).
   - Dispatches OSC `/Input_Channels/{id}/Channel_Input/name` $\rightarrow$ `"VOX1 84%"`.
3. **S-Series Channel Strip Color Index (`computeS21ColorCode`)**:
   - Evaluates clipping and battery thresholds and dispatches `/Input_Channels/{id}/Channel_Input/color`:
     - `2` (**Green**): Operational (`batteryPercent >= 20` and `clip === false`)
     - `5` (**Amber**): Low battery warning (`batteryPercent < 20`)
     - `6` (**Red**): Capsule/transmitter clipping (`clip === true`) or critical battery (`<= 10%`)
4. **Mixing Station Stage Tablet Relay**:
   - Mirrors the S21 OSC packets and dispatches `/MixingStation/ch/{id}/battery`, `/MixingStation/ch/{id}/clip`, and `/MixingStation/ch/{id}/nexlink` to all registered stage tablets.

---

## 3. Dual-Mode Panic Switch State Machine (`activePanicTarget`)

```
                    ┌───────────────────────────────────┐
                    │   MODE A: COMMS MODE (Default)    │
                    │     activePanicTarget === null    │
                    │                                   │
                    │  Pedal Down: Ch 48 Mute -> 0 (ON) │
                    │  Pedal Up:   Ch 48 Mute -> 1 (OFF)│
                    └───────────┬───────────▲───────────┘
                                │           │
          setActiveChannel(X)   │           │  clearArmedChannel()
                                ▼           │
                    ┌───────────┴───────────┴───────────┐
                    │       MODE B: PANIC MODE          │
                    │       activePanicTarget = X       │
                    │                                   │
                    │  Pedal Down (PANIC):              │
                    │    • /Input_Channels/X/mute -> 1  │
                    │    • /Matrix_Channels/1/mute -> 0 │
                    │  Pedal Up (RESTORE SHOW):         │
                    │    • /Input_Channels/X/mute -> 0  │
                    │    • /Matrix_Channels/1/mute -> 1 │
                    └───────────────────────────────────┘
```
