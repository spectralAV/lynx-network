# Mixing Station Integration & Stage Tablet IEM Firewall

On a live production stage with a **DiGiCo S21 / S31** console and **Sound Devices Astral** wireless racks, deploying **Mixing Station** on stage tablets introduces two classic Pro-AV engineering problems:

1. **The DiGiCo S-Series Single-Client UDP OSC Limitation**:
   Native DiGiCo S-Series consoles track only the source IP/port of the last UDP OSC packet received. If Bitfocus Companion at FOH and 4–8 musician iPads on stage all send OSC packets directly to port `8000` on the S21, they continually hijack the return socket from one another, causing dead faders and lost feedback.
2. **Stage Tablet Safety & RF Telemetry Blindness**:
   Standard OSC mixer profiles expose main FOH faders, preamps/trims, and master mutes to every connected tablet—and provide zero visibility into wireless pack battery life or capsule overload.

**Lynx Network** solves both problems via `src/mixing-station.ts` (`MixingStationSessionManager`) and `src/osc.ts` (`DiGiCoOscProxyBroker`).

---

## 1. Network Architecture for Mixing Station

Instead of connecting Mixing Station tablets directly to the DiGiCo S21 (`:8000`), point all stage tablets to the **Lynx Network Multi-Client Proxy Port** (`:8001` default):

```
┌────────────────────────────┐
│ Musician iPad 1 (@aux1)    │──┐
│ 192.168.1.51:9000          │  │
├────────────────────────────┤  │  UDP OSC (:8001)   ┌───────────────────────────┐   Single Socket (:8000)   ┌────────────────────┐
│ Musician iPad 2 (@aux2)    │──┼───────────────────▶│       Lynx Network        │──────────────────────────▶│ DiGiCo S21 Console │
│ 192.168.1.52:9000          │  │                    │ • IEM Bus ACL Firewall    │◀──────────────────────────│ 192.168.1.21:8000  │
├────────────────────────────┤  │                    │ • Mode B Panic-Lock Guard │                           └────────────────────┘
│ FOH Rover iPad (@foh)      │──┘                    │ • Late-Join Snapshot Sync │                                     ▲
│ 192.168.1.99:9000          │                       └─────────────┬─────────────┘                                     │
└────────────────────────────┘                                     │                                                   │
                                                                   ▼                                                   │
                                                     ┌───────────────────────────┐                                     │
                                                     │ Sound Devices Astral      │─────────────────────────────────────┘
                                                     │ A20-Nexus / ARX32 (:8080) │  Scribble Rename ("VOX1 84%")
                                                     └───────────────────────────┘  + Strip Color (2=Green, 5=Amber, 6=Red)
```

---

## 2. Per-Musician Bus Pinning & FOH Rover Roles (`@auxN` / `@foh`)

In the Bitfocus Companion connection settings for **Lynx Network**, the `mixingStationClients` field accepts comma-separated `IP:Port` endpoints with optional `@auxN` or `@foh` access control tags:

```text
192.168.1.51:9000@aux1, 192.168.1.52:9000@aux2, 192.168.1.53:9000@aux3, 192.168.1.99:9000@foh
```

| Endpoint Tag | Role | Permitted Outbound OSC to S21 | Blocked by Firewall |
| --- | --- | --- | --- |
| `IP:Port@aux1` | Stage Musician 1 (e.g. Lead Vocal IEM) | • `/Input_Channels/*/Aux_Send/1/level`<br>• `/Input_Channels/*/Aux_Send/1/mute`<br>• `/Aux_Outputs/1/level`<br>• `/MixingStation/bus/1/ch/*/level` | • Aux Buses `2..N`<br>• FOH Main Channel Faders & Mutes<br>• S21 Input Trims<br>• FOH Talkback Ch 48 & Tech Matrix 1 |
| `IP:Port` *(no tag)* | Stage Musician (Any Aux IEM Bus) | • Any `/Input_Channels/*/Aux_Send/*/level` & `mute`<br>• Any `/Aux_Outputs/*/level` | • FOH Main Channel Faders & Mutes<br>• S21 Input Trims<br>• FOH Talkback Ch 48 & Tech Matrix 1 |
| `IP:Port@foh` | FOH / Monitor Engineer Rover iPad | • Full DiGiCo S21 Console OSC control | • **Mode B Panic-Lock Guard**: Cannot unmute a channel in the PA while FOH is actively stomping the Panic floor pedal |

---

## 3. Late-Joining Tablet State Snapshot Sync

When a musician turns on their tablet mid-rehearsal or reconnects to Wi-Fi:
1. As soon as Mixing Station sends its first UDP packet (or `/MixingStation/sync` / `/hi`) to port `8001`, **Lynx Network** automatically registers the tablet endpoint.
2. `syncStateToTablet()` immediately pushes the cached state of all mapped channels—including restricted-slice scribble names (`"VOX1 84%"`), S21 strip colors (`2`/`5`/`6`), current Aux IEM send levels, and normalized battery bars (`0.0–1.0`)—so the tablet UI populates without waiting for the next console move.

---

## 4. Mixing Station Generic OSC Address Dictionary

Reference profiles are provided in:
- [`mixing-station/lynx-network-generic-osc-profile.json`](../mixing-station/lynx-network-generic-osc-profile.json)
- [`mixing-station/musician-iem-tablet-layout.json`](../mixing-station/musician-iem-tablet-layout.json)

| Parameter | OSC Address Pattern | Type | Range / Values | Direction |
| --- | --- | --- | --- | --- |
| **Scribble-Strip Name + Battery** | `/Input_Channels/{ch}/Channel_Input/name` | `s` | `"VOX1 84%"` (Max 12 chars) | Lynx $\rightarrow$ Tablet & S21 |
| **Strip Color Index** | `/Input_Channels/{ch}/Channel_Input/color` | `i` | `2` Green, `5` Amber ($<20\%$), `6` Red (Clip) | Lynx $\rightarrow$ Tablet & S21 |
| **Aux IEM Send Level (S21 Native)** | `/Input_Channels/{ch}/Aux_Send/{aux}/level` | `f` | `-90.0` to `+10.0` dB | Bidirectional (Synced with Dial 3) |
| **Aux IEM Send Level (Alias)** | `/MixingStation/bus/{aux}/ch/{ch}/level` | `f` | `-90.0` to `+10.0` dB | Tablet $\rightarrow$ Lynx $\rightarrow$ S21 |
| **Aux IEM Send Mute** | `/Input_Channels/{ch}/Aux_Send/{aux}/mute` | `i` | `0` (Unmuted), `1` (Muted) | Bidirectional |
| **RF Battery Percentage** | `/MixingStation/ch/{ch}/battery` | `i` | `0` – `100` | Lynx $\rightarrow$ Tablet |
| **RF Battery Meter Bar** | `/MixingStation/ch/{ch}/battery_bar` | `f` | `0.00` – `1.00` | Lynx $\rightarrow$ Tablet |
| **Capsule / TX Clip LED** | `/MixingStation/ch/{ch}/clip` | `i` | `0` (OK), `1` (CLIP!) | Lynx $\rightarrow$ Tablet |
| **NexLink / ShowLink Quality** | `/MixingStation/ch/{ch}/nexlink` | `i` | `0` – `100` | Lynx $\rightarrow$ Tablet |
| **RF Health Summary Badge** | `/MixingStation/ch/{ch}/status_text` | `s` | `"84% | NL:98%"`, `"CLIP OVERLOAD!"` | Lynx $\rightarrow$ Tablet |
| **FOH Panic Active Flag** | `/MixingStation/panic/active` | `i` | `0` (Normal), `1` (Panic Active) | Lynx $\rightarrow$ Tablet |
| **FOH Panic Target Banner** | `/MixingStation/panic/target_name` | `s` | `"NONE"` or `"PANIC: VOX1 (CH 1)"` | Lynx $\rightarrow$ Tablet |
| **Request Full Snapshot Sync** | `/MixingStation/sync` | `i` | `1` | Tablet $\rightarrow$ Lynx |
