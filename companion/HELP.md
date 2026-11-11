# Lynx Network (DiGiCo S21 & Sound Devices Astral Orchestrator)

## Overview
**Lynx Network** operates as a smart, multi-client, context-aware network broker between:
1. **Sound Devices Astral (A20-Nexus / ARX32)** wireless receivers (inbound WebSocket telemetry stream, extensible to Shure Axient Digital TCP and Sennheiser D6000 UDP).
2. **DiGiCo S21 Mixing Console** (single persistent UDP OSC socket on Port `8000` bypassing the S-Series single-controller limitation).
3. **Mixing Station Stage Tablets** (relayed restricted OSC states and live battery telemetry).
4. **Elgato Stream Deck + XL + USB Foot Pedal** (Dual-Mode Panic Switch, top grid status colors, LCD touch strip telemetry, and 4 contextual rotary encoders).

## Dual-Mode Panic Switch (`activePanicTarget`)
- **Mode A (Comms Mode / `activePanicTarget === null`)**:
  Stomping the foot switch acts as momentary Push-To-Talk (PTT) on FOH Talkback Channel 48 (`/Input_Channels/48/Channel_Input/mute` -> `0` pressed, `1` released).
- **Mode B (Panic Mode / `activePanicTarget = X`)**:
  Stomping the foot switch drops armed performer channel `X` from the main PA (`/Input_Channels/X/Channel_Input/mute` -> `1`) and opens the tech comms matrix (`/Matrix_Channels/1/Channel_Input/mute` -> `0`). Releasing restores normal show state.
