# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (TypeScript → .homeybuild/)
npm run build

# Lint
npm run lint

# Install on Homey device (requires Homey CLI)
homey app install

# Run in development mode with live logs
homey app run
```

No test suite exists. Validation is done manually via `homey app run` and the diagnostics snapshot collector in the settings page.

## Architecture Overview

This is a Homey v3 app integrating with Hoymiles HiOne BESS systems. The v2.0.0 rewrite introduced a multi-device architecture where one physical plant is represented as 4 separate Homey devices.

### Device Types

| Driver | Homey class | Role |
|---|---|---|
| `station` | `battery` | Main plant device — 37+ capabilities, all actions |
| `inverter` | `solarpanel` | Per-inverter 3-phase data (read-only) |
| `gateway` | `other` | HiBox/DTS online/offline state |
| `battery` | `other` | Per-module battery cell data |

### Data Flow

```
PollingService (30–300s interval)
  └── HoymilesApi (cloud) + ModbusTcpClient / ProtobufClient (local LAN)
        └── DataNormalizer → merged snapshot
              └── listener callbacks → Station/Inverter/Gateway/Battery devices
```

Devices never call the API directly. All data flows through `PollingService` via snapshot listener callbacks registered on `onAdded` / `onInit`.

### Connection Modes

Three modes configured per station during pairing:
- **Cloud Only** — S-Miles Cloud REST API
- **Hybrid** — Cloud primary, local LAN fallback
- **Local Only** — Direct HiBox/DTS gateway (Protobuf port 10081 or Modbus TCP port 502)

### Core Libraries (`lib/`)

- **`HoymilesApi.js`** — Cloud REST client. Supports 4 auth profiles (web_v3, installer_v3, home_v3, legacy_v0) with Argon2id hash-wasm + MD5/SHA256 fallbacks. Auto-refreshes tokens on expiry (status 100).
- **`PollingService.js`** — Per-plant polling orchestration. Maintains a `plantId → Map(deviceId → callback)` listener registry. Stores a separate `HoymilesApi` instance per plant.
- **`ModbusTcpClient.js`** — Modbus FC03 over TCP. DTU info at 0x0000, PV ports at 0x1000+, plant aggregate at 0x2000+. ESS blocks (0x3000–0x6000) probed but not confirmed on HiBox.
- **`ProtobufClient.js`** — HW magic-header binary protocol on port 10081. Supports real data read (0x0102), inverter power limit (0x0501), inverter on/off (0x0400/0x0401).
- **`DataNormalizer.js`** — Applies ±10 W deadband on battery/grid splits (prevents flickering), validates plausibility ranges, derives battery/grid state enums, calculates self-powered %, runtime, time-to-full.
- **`DiagnosticsEngine.js`** — Parallel Modbus + Protobuf snapshot collector for register discovery; exported as JSON from settings page.
- **`HttpClient.js`** — HTTP/HTTPS wrapper with redirect handling and 15 s timeout.

### Snapshot Structure

```javascript
{
  plantId,
  timestamp,
  cloud: { /* raw cloud API response */ },
  local: { /* raw local protocol response */ },
  merged: { /* normalized combined data */ },
  source: 'cloud' | 'local' | 'hybrid' | 'unknown',
  error: null | 'error message'
}
```

### Pairing Flow (`drivers/station/driver.ts`)

3-step wizard:
1. **login_credentials** — email/password, auth mode selector, optional custom API URL
2. **select_station** — paginated station list from cloud
3. **configure_local** — optional gateway IP, protocol, port, Modbus unit ID, connection mode

After pairing, child devices (Inverter, Gateway, Battery) are added manually and share the parent station's data stream.

### Capabilities & Flow Cards

Custom capabilities are defined in `.homeycompose/capabilities/` (50 total, prefixed `hoymiles_`). Flow cards are in `.homeycompose/flow/triggers/`, `.../conditions/`, `.../actions/`.

`app.json` at root is **auto-generated** by `homey app build` from `.homeycompose/`. Edit `.homeycompose/app.json` and the subdirectories, not the root `app.json`.

Flow card logic (thresholds, transitions, token emission) is implemented in `app.ts` and `drivers/station/device.ts`.

### Localization

`locales/en.json` and `locales/nl.json`. All user-visible strings must have entries in both files.

### TypeScript vs JavaScript

- `app.ts` and all driver files (`drivers/*/driver.ts`, `drivers/*/device.ts`) are TypeScript.
- All `lib/` files are plain JavaScript (CommonJS).
- Build output goes to `.homeybuild/`; the Homey runtime loads from there.
