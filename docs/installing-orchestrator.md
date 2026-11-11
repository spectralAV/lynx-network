# Installing & Attaching DiGiCo Astral Orchestrator

This guide covers building `companion-module-digico-astral-orchestrator` from source, verifying it with the included Alpha State Stage Simulator (`mock-hardware-stage.js`), and attaching it to **Bitfocus Companion v3 / CompanionOS**.

---

## 1. Prerequisites

- **Node.js**: `v18.0.0` or newer (`v22+` recommended)
- **npm**: `v9+`
- **Bitfocus Companion**: `v3.1+` (Desktop or CompanionPi / CompanionOS)
- **Hardware Surface (Optional in Alpha)**: Elgato Stream Deck + / Stream Deck XL and a USB sustain/foot-switch (HID keyboard or USB-MIDI).

---

## 2. Build From Source

```powershell
git clone https://github.com/spectralAV/companion-module-digico-astral-orchestrator.git
cd companion-module-digico-astral-orchestrator
npm install
npm run build
```

Verify your build and local network ports with the automated test suite:

```powershell
npm test
```

---

## 3. Simulator Verification (`mock-hardware-stage.js`)

Before connecting physical stage racks, you can validate the entire pipeline locally:

### Option A: Self-Contained Automated Walkthrough
Runs the mock Sound Devices Astral WebSocket server (`:8080`), DiGiCo S21 UDP OSC server (`:8000`), and Mixing Station stage tablet listener (`:9000`), attaches the orchestrator, and steps through telemetry ingestion, Mode A Comms PTT, Mode B Panic stomps, and Rotary Encoder adjustments:

```powershell
node mock-hardware-stage.js --demo
```

### Option B: Persistent Simulator for Bitfocus Companion GUI
Keep the mock hardware stage running in a terminal while you test buttons and dials in Bitfocus Companion:

```powershell
npm run sim
```

---

## 4. Installing into Bitfocus Companion v3 (Developer Module Path)

### Automatic Placement (Windows PowerShell)
Run the included installer script to build and copy/link the module into your user `companion-module-dev` directory:

```powershell
.\scripts\install-companion-dev.ps1
```

### Manual Placement (Windows / macOS / Linux / CompanionOS)
1. Ensure `npm run build` has generated the `dist/` folder.
2. Copy or symlink the repository folder into your Companion developer modules directory:
   - **Windows**: `C:\Users\<Username>\companion-module-dev\companion-module-digico-astral-orchestrator`
   - **macOS / Linux / CompanionOS**: `~/companion-module-dev/companion-module-digico-astral-orchestrator`
3. Launch Bitfocus Companion (or click **Rescan Modules** in the Companion Developer settings).
4. Add a new Connection and select **DiGiCo / Sound Devices: s21-astral** (`digico-astral-orchestrator`).

---

## 5. Production Gigabit Switch Setup

| Device | Default IP / Port | Protocol | Notes |
| --- | --- | --- | --- |
| **DiGiCo S21 Console** | `192.168.1.21:8000` | UDP OSC | Point the Orchestrator's `s21Host` and `s21Port` here. |
| **Orchestrator Proxy Port** | `0.0.0.0:8001` | UDP OSC | Point external Stream Decks or Mixing Station clients here to share the single S21 socket. |
| **Sound Devices Astral (A20-Nexus / ARX32)** | `192.168.1.30:8080` | WebSocket JSON | Select `astral_ws` in Wireless Telemetry Receiver Driver. |
| **Mixing Station Stage Tablets** | `192.168.1.50:9000` | UDP OSC | Enter comma-separated `IP:Port` pairs in `mixingStationClients`. |
