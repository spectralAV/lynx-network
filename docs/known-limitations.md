# Known Limitations (Alpha State)

1. **Simulation-Driven Alpha Validation**:
   - `v0.1.0-alpha.1` has been developed and verified against the included `mock-hardware-stage.js` hardware stage simulator. Physical firmware variations across DiGiCo S21 / S31 software releases should be verified during stage prep.
2. **DiGiCo S-Series Single-Controller UDP Socket**:
   - Native DiGiCo S-Series consoles track the source IP/port of the most recent OSC controller. When using Mixing Station tablets alongside Companion, always point Mixing Station to the Orchestrator's **Multi-Client OSC Proxy Listen Port** (`8001` default) rather than directly to the console's port `8000`.
3. **Scribble-Strip Character Length**:
   - S21 channel scribble strips have limited character width. `maxNameLength` defaults to `12` characters (e.g., `"VOX1 84%"`) so battery percentages are never truncated on the console surface.

