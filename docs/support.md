# Support & Diagnostics Guide

When opening a [GitHub Issue](https://github.com/spectralAV/companion-module-digico-astral-orchestrator/issues/new/choose), include the following diagnostic details:

## 1. Environment Check
Run the environment validation script from the repository root:

```powershell
.\scripts\validate-environment.ps1
```

## 2. Stage Simulator Verification Output
Attach the output of the self-contained simulator demo:

```powershell
node mock-hardware-stage.js --demo
```

## 3. Bitfocus Companion Module Logs
1. Open the Bitfocus Companion web GUI.
2. Navigate to **Connections** $\rightarrow$ **s21-astral** $\rightarrow$ **View Logs**.
3. Copy relevant `info`, `warn`, or `error` lines and redact any private venue network credentials before posting publicly.
