# Hoymiles HiOne — Homey App

Monitor and control your **Hoymiles HiOne** battery energy storage system (BESS) from Homey via Cloud, Modbus TCP and Protobuf.

[![Homey App](https://img.shields.io/badge/Homey-App%20Store-00A94F?logo=homey)](https://homey.app/a/com.hoymiles.hione)
[![Homey App Test](https://img.shields.io/badge/Homey-Test%20App-FFA500?logo=homey)](https://homey.app/en-nl/app/com.hoymiles.hione/Hoymiles-HiOne/test/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

> App has not yet been submitted for certification but is available via [test](https://homey.app/en-nl/app/com.hoymiles.hione/Hoymiles-HiOne/test/) link.

## Disclaimer

> **This is an unofficial, community-developed integration.**
>
> - Not affiliated with, endorsed by, or supported by **Hoymiles Power Electronics Inc.**
> - Uses the reverse-engineered S-Miles Cloud API and/or local DTU communication, neither of which are publicly documented.
> - Hoymiles may change or discontinue these interfaces at any time without notice.
> - Your **S-Miles Cloud credentials** are stored securely in Homey's encrypted device store and are only sent to the official Hoymiles API.
> - Use at your own risk.

## Features

### Multi-device architecture

v2.0.0 introduces a multi-device architecture. Each component of the HiOne system is a separate Homey device:

| Driver | Homey class | Description |
|---|---|---|
| **Station** | `battery` | Main plant — PV, battery, grid, load, energy, modes, settings |
| **Inverter** | `solarpanel` | Per-inverter — 3-phase voltage/current/power, frequency, temperature |
| **Gateway** | `other` | HiBox/DTS — online status, system state |
| **Battery** | `other` | Per-battery module — SoC, SoH, voltage, current, cell data |

### Monitoring & control

- **Real-time monitoring**: PV power, battery SoC, charge/discharge power, grid import/export (signed and split), home load
- **Energy totals**: daily, monthly, yearly, and lifetime
- **Calculated insights**: self-powered percentage, battery runtime estimate, time-to-full estimate, power balance
- **Financial & environmental**: profit today/total, CO₂ reduction
- **Settable battery parameters**: Battery mode, Reserve SoC, Max SoC, Max Charge/Discharge Power, Grid Limit
- **8 battery modes**: Self-Consumption, Economy, Backup, Off-Grid, Force Charge, Force Discharge, Peak Shaving, Time of Use

### Connection modes

| Mode | Description |
|---|---|
| **Cloud Only** | Via S-Miles Cloud API. Requires a hoymiles.com account. |
| **Hybrid** | Cloud + local LAN. Best reliability. |
| **Local Only** | Direct to HiBox/DTS gateway. No cloud account needed. |

Local protocols supported:
- **Protobuf** (port 10081) — proprietary binary protocol
- **Modbus TCP** (port 502) — for DTS-G3 sticks

### Homey integration

- **Homey Energy** — `homeBattery` with `meter_power.charged` and `meter_power.discharged`
- **14 flow triggers** — battery state changes, SoC thresholds, grid/PV events, gateway online/offline, connection source, mode changes
- **11 flow conditions** — battery state, SoC, grid, PV/load power, mode, gateway, connection
- **12 flow actions** — set mode, SoC, power, grid limit, peak shaving, ToU period, inverter on/off, power limit, relay, refresh

## Requirements

- Homey Pro (2019 or 2023) with firmware >= 12.0.0
- Hoymiles **HiOne** BESS with HiBox or DTS gateway
- For cloud/hybrid mode: an active **S-Miles Cloud** account
- For local mode: the IP address of the gateway on your LAN

> **Compatibility note**: Designed for the HiOne (HiBox-63T-G3 gateway). Other Hoymiles products (DTU, microinverters, HYT series) are *not* supported.

## Installation

### Via Homey App Store
Search for **"Hoymiles HiOne"** in the Homey App Store.

### Via CLI (sideloading / development)
```bash
npm install -g homey
git clone https://github.com/rcoemans/com.hoymiles.hione
cd com.hoymiles.hione
npm install
npm run build
homey login
homey app install
```

## Adding devices

### Step 1: Add a Station (required first)

1. Open the Homey app → **Devices** → tap **+**
2. Search for **"Hoymiles HiOne"** → tap **HiOne Station**
3. Log in with your **S-Miles Cloud** email and password
4. Select your station from the list
5. Optionally configure local LAN connection (gateway IP, protocol, port)
6. Done — data refreshes every 60 seconds (configurable 30–300s)

### Step 2: Add child devices (optional)

After the Station is added, you can add **Inverter**, **Gateway**, and **Battery** devices:

1. Tap **+** → search for **"Hoymiles HiOne"** → select the device type
2. Select the parent Station
3. The app auto-discovers the connected devices
4. Done — child devices receive data from the same polling service

### Finding your HiBox IP address

Check your router's admin page under connected/DHCP devices. Look for a device named `DTUBI-...` or `HiBox`. Default port: **10081** (Protobuf) or **502** (Modbus TCP).

> **Tip**: Choose **Hybrid** mode for the best experience — local for speed, cloud as fallback.

## Data & capabilities

### Station capabilities (37)

| Category | Capabilities |
|---|---|
| **Power** | PV power, battery power, grid power, load power, battery charge/discharge power (split), grid import/export power (split), power balance |
| **Energy** | Daily, monthly, yearly, total energy, CO₂ reduction, profit today/total |
| **Battery** | SoC (%), battery state (charging/discharging/idle), battery mode (8 modes), battery flow text, battery runtime, time to full |
| **Grid** | Grid state (importing/exporting/neutral) |
| **Settings** | Reserve SoC, max SoC, max charge power, max discharge power, grid limit (all settable) |
| **System** | System state, connection source, gateway online, last update, alarm, self-powered % |

### Inverter capabilities (15)

3-phase voltage/current/power (A, B, C), frequency, temperature, bus voltage, inverter status, last update

### Gateway capabilities (4)

Gateway online, system state, alarm, last update

### Battery capabilities (12)

SoC, SoH, voltage, current, max/min cell voltage, max/min cell temp, battery state, fault code, power, last update

## Flow cards

### Triggers (14)

- Battery started/stopped charging/discharging
- Battery SoC rose above / dropped below threshold
- Battery mode changed (with mode token)
- Grid started importing / exporting
- PV production started / stopped
- Gateway came online / went offline
- Connection source changed (with source token)

### Conditions (11)

- Battery is/is not charging/discharging
- Battery SoC is/is not above/below threshold
- Grid is/is not importing/exporting
- PV/load power is/is not above threshold
- Battery mode is/is not a specific mode
- Gateway is/is not online
- Connection is/is not local

### Actions (12)

- **Set battery mode** — Self-Consumption, Economy, Backup, Off-Grid, Force Charge, Force Discharge, Peak Shaving, Time of Use
- **Set reserve SoC / max SoC** — battery charge limits
- **Set max charge / discharge power** — power limits (%)
- **Set grid limit** — Peak Shaving grid limit (W)
- **Set peak shaving parameters** — reserve SoC + max SoC + grid limit
- **Set time-of-use period** — full charge/discharge schedule
- **Set inverter state** — turn on/off by serial number
- **Set inverter power limit** — output limit (2–100%)
- **Set relay** — enable/disable dry contact output
- **Refresh data now** — immediate poll

## Device settings

Station device settings (editable without re-pairing):

| Setting | Description | Default |
|---|---|---|
| Connection mode | Cloud Only, Hybrid, or Local Only | Cloud |
| Gateway IP | Local LAN IP of the HiBox/DTS gateway | — |
| Protocol | Protobuf or Modbus TCP | Protobuf |
| Port | TCP port | 10081 |
| Modbus Unit ID | Modbus slave address | 1 |
| Cloud API URL | S-Miles Cloud API base URL (auto-detected during login) | `https://neapi.hoymiles.com` |
| Poll interval | 30–300 seconds | 60 |

System info labels (read-only): model, serial number, firmware version, hardware version, connected devices.

## App settings

The app settings page (Homey > Apps > Hoymiles HiOne > Settings) provides:

- **Test Cloud Login** — verify S-Miles Cloud credentials
- **Diagnostics** — Modbus TCP + Protobuf snapshot collector for data correlation and register discovery
  - Configure gateway IP, interval, DTU serial, Modbus unit ID
  - **Start/Stop** snapshot collection
  - **Export** collected data as JSON for analysis
  - **Clear** all snapshots

## How it works

### Architecture

```
┌─────────────────────────────────────────────┐
│  app.ts (HoymilesHiOneApp)                  │
│  ├── PollingService (per-plant polling)      │
│  ├── DiagnosticsEngine (snapshot collector)  │
│  └── Flow card registrations                │
├─────────────────────────────────────────────┤
│  Station device.ts ←── data snapshots       │
│  Inverter device.ts ←── data snapshots      │
│  Gateway device.ts ←── data snapshots       │
│  Battery device.ts ←── data snapshots       │
├─────────────────────────────────────────────┤
│  lib/                                       │
│  ├── HoymilesApi.js    (Cloud REST client)  │
│  ├── ModbusTcpClient.js (Modbus TCP)        │
│  ├── ProtobufClient.js  (Port 10081)        │
│  ├── DataNormalizer.js   (Validation)       │
│  ├── PollingService.js   (Polling engine)   │
│  ├── DiagnosticsEngine.js (Diagnostics)     │
│  └── HttpClient.js       (HTTP wrapper)     │
└─────────────────────────────────────────────┘
```

### S-Miles Cloud API

Authentication uses a modern **two-step v3 flow** with automatic multi-profile fallback:

1. **Pre-inspect** — `POST /iam/pub/3/auth/pre-insp` with `{ u: email }` to obtain a one-time nonce (and optional Argon2 salt)
2. **Login** — `POST /iam/pub/3/auth/login` with `{ u: email, ch: credentialHash, n: nonce }`

Three client profiles are tried in order:

1. **Web** — generic web client headers
2. **S-Miles Installer** — Installer app headers (`App-Version: 3.7.1`, `X-App-Version: 3.7.1`, `X-Client-Type: mobile`)
3. **S-Miles Home** — EU consumer gateway (`euapi.hoymiles.com`, `User-Agent: sma/ad/2.10.0/159/0`)

After all v3 profiles, a **Legacy v0** fallback (`POST /iam/pub/0/auth/login` with MD5-hashed password) is attempted for older accounts.

**Argon2id** (salted v3) is fully supported via the `hash-wasm` library. If the pre-inspect returns a salt, the app computes the Argon2id hash (time_cost=3, memory_cost=32768, parallelism=1, hash_length=32). **Unsalted** accounts use `md5(pw).sha256_base64(pw)` or `sha256_hex(pw)` credential hashes.

Token auto-refresh on expiry with transparent re-authentication.

Key endpoints:
- `/iam/pub/3/auth/pre-insp` — pre-inspection (nonce + optional salt)
- `/iam/pub/3/auth/login` — v3 authentication
- `/pvm/api/0/station/select_by_page` — station listing
- `/pvm-data/api/0/station/data/count_station_real_data` — real-time power/energy
- `/pvm-data/api/0/station/data/count_device_by_station` — device listing
- `/pvm-ctl/api/0/dev/setting/read` and `/write` — battery settings R/W with job polling

### Local API (Protobuf, port 10081)

Binary frame protocol with `HW` magic header. Supports:
- Real-time data retrieval
- Inverter power limit control
- Inverter on/off control
- No authentication required on LAN

### Modbus TCP (port 502)

FC03 (Read Holding Registers) for DTU-Pro compatible devices:
- DTU info (0x0000), PV ports (0x1000+), Plant aggregate (0x2000+)
- ESS candidate blocks (0x3000–0x6000) probed but not confirmed on HiBox
- Per-field plausibility validation rejects garbage data

### Data validation

All values pass through `DataNormalizer.js`:
- ±10 W deadband prevents state flickering on battery/grid splits
- Plausibility ranges: PV 0–100kW, battery ±50kW, grid ±100kW, SoC 0–100%, energy 0–200kWh daily
- Invalid values are rejected (not set to zero) to preserve previous good values

### Signed power conventions

| Value | Meaning |
|---:|---|
| `battery_power > 0` | Battery charging |
| `battery_power < 0` | Battery discharging |
| `grid_power > 0` | Importing from grid |
| `grid_power < 0` | Exporting to grid |

## Known limitations

| Limitation | Detail |
|---|---|
| Unofficial API | May break if Hoymiles updates their backend or local protocol |
| HiOne only | Not tested with DTU, micro-inverters, or HYT series |
| Local polling | Intervals below 30 seconds can disrupt cloud and mobile app connectivity |
| Battery capacity | Runtime estimates use 30 kWh default (HiOne 4×8 kWh) |
| Modbus ESS | Battery/grid/load data not available via Modbus TCP on HiBox — use Protobuf or Cloud |

## Security

- **Cloud credentials** are stored in Homey's encrypted device store and only transmitted to the official Hoymiles S-Miles Cloud API
- **Local communication** does not require authentication (HiBox limitation)
- Passwords are hashed (Argon2id or MD5) before transmission — raw passwords are never sent

## Credits

This app is a co-creation between **Robert Coemans** and **Claude** (Anthropic), built using **[Windsurf](https://windsurf.com)** — an AI-powered IDE for collaborative software development.

If you like this, consider [buying me a coffee](https://buymeacoffee.com/kabxpqqg7z).

Pull requests and issue reports are welcome on [GitHub](https://github.com/rcoemans/com.hoymiles.hione).

## Acknowledgements

- **Inspiration:** [Hoymiles HiOne — Homey App](https://github.com/ItsRaYnor/homey-app-hoymiles-hione)
- **Local protocol reference:** [hoymiles-wifi](https://github.com/suaveolent/hoymiles-wifi) — Python library for local DTU communication via protobuf (MIT)
- **Cloud API reference:** [homeassistant-hoymiles-cloud](https://github.com/Philra94/homeassistant-hoymiles-cloud) — Home Assistant integration for Hoymiles Cloud API
- **API documentation:** [hoymiles-api](https://github.com/Xinayder/hoymiles-api) — Reverse-engineered Hoymiles API docs
- **Modbus TCP reference:** [Hoymiles-Plant-DTU-Pro](https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro) — Hoymiles DTU-Pro Modbus TCP integration
- **Modbus TCP reference:** [ha-hoymiles-modbus-tcp](https://github.com/wil-lem/ha-hoymiles-modbus-tcp) — Hoymiles Modbus TCP integration for Home Assistant
