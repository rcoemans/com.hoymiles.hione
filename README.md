# Hoymiles HiOne — Homey App

Monitor and control your **Hoymiles HiOne** all-in-one battery energy storage system (BESS) from Homey.

[![Homey App](https://img.shields.io/badge/Homey-App%20Store-00A94F?logo=homey)](https://homey.app/a/com.hoymiles.hione)
[![Homey App Test](https://img.shields.io/badge/Homey-Test%20App-FFA500?logo=homey)](https://homey.app/en-nl/app/com.hoymiles.hione/Hoymiles-HiOne/test/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

> App has not yet been submitted for certification but is available via [test](https://homey.app/en-nl/app/com.hoymiles.hione/Hoymiles-HiOne/test/) link.

## Disclaimer

> **This is an unofficial, community-developed integration.**
>
> - Not affiliated with, endorsed by, or supported by **Hoymiles Power Electronics Inc.**
> - Uses the reverse-engineered S-Miles Cloud API (`neapi.hoymiles.com`) and/or local DTU communication, neither of which are publicly documented.
> - Hoymiles may change or discontinue these interfaces at any time without notice — app functionality may break as a result.
> - Your **S-Miles Cloud credentials** are stored securely in Homey's encrypted device store. They are only sent to the official Hoymiles API and never to any third party.
> - Use at your own risk. The developers accept no liability for data loss, incorrect readings, or unintended battery mode changes.

## Features

- **Real-time monitoring**: PV power, battery state-of-charge, battery charge/discharge power, grid import/export (signed and split), home load
- **Energy totals**: daily yield and lifetime total
- **Calculated insights**: self-powered percentage, battery runtime estimate, time-to-full estimate, power balance, energy independence state
- **Battery mode control** via Flows:
  - Self-Consumption, Economy, Backup, Off-Grid, Peak Shaving, Time of Use
- **Flow triggers**: battery started/stopped charging, battery started/stopped discharging, SoC changed, SoC crossed threshold, grid started importing/exporting, PV production started/stopped, gateway online/offline, connection source changed, battery mode changed
- **Flow conditions**: battery is/is not charging, battery is/is not discharging, SoC above/below threshold, PV power above threshold, load power above threshold, grid is/is not importing, grid is/is not exporting, battery mode is/is not, gateway is/is not online, connection is/is not local
- **Flow actions**: set battery mode, refresh data, prefer local/cloud connection, enable/disable cloud fallback
- **Three connection modes**:
  - **Local (LAN)** — direct connection to the HiBox gateway via IP. Supports protobuf (port 10081) and **Modbus TCP** (port 502, for DTS-G3 sticks). No cloud account needed. Works offline.
  - **Local + Cloud** — local as primary, S-Miles Cloud as fallback. Best reliability.
  - **Cloud only** — via S-Miles Cloud API. Requires a hoymiles.com account.
- **Modbus TCP support** for DTS-G3 sticks — automatic fallback when protobuf is unavailable
- **Homey Energy integration** — battery charge/discharge power and cumulative energy are reported to Homey Energy via the device’s energy configuration
- **Cloud login hardening** — exponential backoff after failed login attempts (up to 12 hours for account lockout) to protect your S-Miles account
- **Register scan diagnostic** — discover available Modbus registers on your DTS-G3 stick from the app settings page
- **Connection source indicator**: see whether data comes from local or cloud

## Requirements

- Homey Pro (2019 or 2023) with firmware >= 10.0.0
- Hoymiles **HiOne** all-in-one BESS (tested: 3-phase models with HiBox-63T-G3 gateway)
- For cloud/hybrid mode: an active **S-Miles Cloud** account (the same credentials used in the Hoymiles app)
- For local mode: the IP address of the HiBox gateway on your LAN

> **Compatibility note**: This app was designed for the HiOne (HiBox-63T-G3 gateway). Other Hoymiles products (DTU, microinverters, HYT series) are *not* supported.

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

## Adding a device

After installing the app, you need to add a device to start monitoring your HiOne:

1. Open the Homey app on your phone
2. Go to **Devices** (bottom bar)
3. Tap the **+** button (top right) to add a new device
4. Search for **"Hoymiles HiOne"** or find it under the **Energy** category
5. Tap **HiOne Station**
6. Choose your connection mode:
   - **Local (LAN)** — enter the IP address of your HiBox gateway and port (default 10081). Find the IP in your router under connected devices, look for `DTUBI-...` or `HiBox`.
   - **Local + Cloud** — enter the gateway IP and port first, then log in with your S-Miles Cloud credentials
   - **Cloud only** — log in with your S-Miles Cloud email and password
7. Select your station from the list
8. Done — data refreshes every 60 seconds

### Device naming

The device name reflects the connection mode:
- **Local**: `{Plant name} (Local {IP})` — e.g. *Coemans (Local 192.168.1.116)*
- **Hybrid**: `{Plant name} (Hybrid {IP})` — e.g. *Coemans (Hybrid 192.168.1.116)*
- **Cloud only**: `{Plant name} (Cloud)` — e.g. *Coemans (Cloud)*

### Finding your HiBox IP address

The HiBox-63T-G3 gateway connects to your local network via Ethernet. To find its IP:

- Check your router's admin page under connected/DHCP devices
- Look for a device named `DTUBI-...` or `HiBox`
- The local connection uses TCP port **10081** by default (configurable during pairing and in device settings)

> **Tip**: For the most reliable experience, choose **Local + Cloud**. The app will use your local network for fast data retrieval, and fall back to the cloud if the gateway is temporarily unreachable.

## Data & capabilities

### Standard capabilities

| Capability | Description | Unit |
|---|---|---|
| Battery SoC | Battery state of charge | % |
| PV Power | Current solar panel output | W |
| Total Energy | Lifetime energy produced | kWh |

### Custom capabilities

| Capability | Description | Unit |
|---|---|---|
| PV Power | Current solar panel output | W |
| Battery Power | Battery charge (+) / discharge (-) power | W |
| Battery Charge Power | Charge power (positive split value) | W |
| Battery Discharge Power | Discharge power (positive split value) | W |
| Grid Power | Grid import (+) / export (-) power | W |
| Grid Import Power | Import power (positive split value) | W |
| Grid Export Power | Export power (positive split value) | W |
| Load Power | Current home consumption | W |
| Daily Energy | Energy produced today | kWh |
| Total Energy | Lifetime energy produced | kWh |
| Battery Mode | Current operating mode | — |
| Battery State | Charging / Discharging / Idle / Standby / Fault | — |
| Grid State | Importing / Exporting / Neutral | — |
| Connection Source | Local (LAN) or Cloud | — |
| Gateway Online | Whether the local gateway is reachable | — |
| System State | Online (local/cloud) / Degraded / Offline / Syncing / Error | — |
| System Alarm | Active when polling fails or system is offline | — |
| Last Update | Timestamp of the last successful poll | — |

### Calculated capabilities

| Capability | Description | Unit |
|---|---|---|
| Self-Powered | Percentage of load covered by solar + battery | % |
| Battery Runtime | Estimated time until battery is empty (when discharging) | h |
| Time to Full | Estimated time until battery is fully charged (when charging) | h |
| Power Balance | PV + grid + battery - load | W |
| Energy Independence | Self-sufficient / Partly importing / Battery supported / Exporting surplus | — |

## Flow cards

### Triggers

- **Battery started/stopped charging**
- **Battery started/stopped discharging**
- **Battery SoC changed** (with SoC token)
- **Battery SoC dropped below / rose above threshold** (configurable %)
- **Grid started importing / exporting**
- **PV production started / stopped**
- **Gateway went offline / came online**
- **Connection source changed** (with source token)
- **Battery mode changed** (with mode token)

### Conditions

- Battery **is/is not** charging
- Battery **is/is not** discharging
- Battery SoC **is/is not** above threshold
- Battery SoC **is/is not** below threshold
- Grid **is/is not** importing power
- Grid **is/is not** exporting power
- PV power **is/is not** above threshold
- Load power **is/is not** above threshold
- Battery mode **is/is not** a specific mode
- Gateway **is/is not** online
- Connection **is/is not** local (LAN)

### Actions

- **Set battery mode** — change the battery operating mode (Self-Consumption, Economy, Backup, Off-Grid, Peak Shaving, Time of Use)
- **Refresh data now** — immediately poll the latest data
- **Prefer local connection** — attempt to reconnect via local gateway
- **Prefer cloud connection** — switch to cloud API
- **Enable/disable cloud fallback** — control automatic fallback behaviour

## Device settings

| Setting | Description | Default |
|---|---|---|
| Connection mode | How the device connects: Local (LAN), Hybrid (local + cloud), or Cloud only | Hybrid |
| Email | S-Miles Cloud login email (editable after pairing) | — |
| Password | S-Miles Cloud password (stored securely on Homey) | — |
| Gateway IP address | Local LAN IP of the HiBox gateway (optional) | — |
| Gateway port | TCP port of the HiBox gateway | 10081 |
| Cloud API URL | Base URL of the S-Miles Cloud API | `https://neapi.hoymiles.com` |
| Poll interval | How often to fetch data (30–300 seconds) | 60 |
| DTU info | Serial number, firmware version, hardware version (read-only) | — |
| Inverter info | Serial number, model, firmware version, hardware version (read-only) | — |
| Gateway info (HiBox) | Serial number, model, firmware version, hardware version (read-only) | — |
| Battery info | Model, number of batteries (read-only) | — |

Device info (DTU, Inverter, Gateway, Battery) is populated automatically from the S-Miles Cloud API device listing endpoint and/or the local protobuf gateway.

The connection mode determines which data source the device uses. You can change this after pairing without re-adding the device. Cloud credentials can also be viewed and changed in the device settings screen. The device tolerates up to 2 consecutive poll failures before marking itself unavailable (showing the specific error reason), and automatically recovers when the connection is restored.

The "Last update" timestamp uses the Homey's configured timezone so it always matches your local time.

## App settings

The app settings page (Homey > Apps > Hoymiles HiOne > Settings) allows you to configure app-level defaults for new device pairings and view diagnostic logs.

### Logging

The app captures all API and device log messages in a ring buffer (last 200 entries). Open the app settings page to view, copy, or clear the log. This is useful for diagnosing cloud API issues, authentication failures, and data retrieval problems.

### Diagnostics

The diagnostics section includes a **Modbus Register Scan** button to discover available data points on a connected DTS-G3 stick. Scan results can be copied to clipboard or cleared using the dedicated buttons.

## How it works

### S-Miles Cloud API

The app communicates with the Hoymiles cloud via the REST API at `neapi.hoymiles.com` using a built-in HTTP client (Node.js `https` module) with automatic redirect following for maximum runtime compatibility. Authentication uses an automatic multi-profile strategy:

1. **v3 Web** — pre-inspection + credential hash without app-version headers (tried first)
2. **v3 S-Miles Installer** — same v3 flow with S-Miles Installer app headers
3. **v3 S-Miles Home** — same v3 flow via EU consumer gateway (`euapi.hoymiles.com`) with genuine S-Miles Home app identity
4. **Legacy v0** — MD5-hashed password (fallback for older accounts)

The app tries each method in order and uses the first one that succeeds. The token is valid for 2 hours and refreshes automatically. If a data request fails with an authentication error, the app automatically re-authenticates and retries the request. If all methods fail, the error message shows the outcome of every attempt for easy debugging.

Accounts that require Argon2id (salted v3) are fully supported — the app uses the `hash-wasm` library for WASM-based Argon2id key derivation (time_cost=3, memory_cost=32768, parallelism=1). If the pre-inspection response includes a salt, the app decodes it (hex or base64) and computes the credential hash accordingly.

Key endpoints:
- Login and authentication (v3 pre-inspection + login, or legacy v0)
- User validation (`/iam/api/1/user/me`)
- Station listing and real-time data (power flows, SoC, energy totals)
- Battery mode read/write

Cloud data field mapping (based on verified API structure):
- `data.reflux_station_data.pv_power` → PV power (W)
- `data.reflux_station_data.bms_power` → Battery power (W)
- `data.reflux_station_data.bms_soc` → Battery SoC (%)
- `data.reflux_station_data.grid_power` → Grid power (W, + import / − export)
- `data.reflux_station_data.load_power` → Home load (W)
- `data.today_eq` → Daily energy (Wh integer → converted to kWh)
- `data.total_eq` → Total energy (Wh integer → converted to kWh)
- `data.tou_mode` → Battery work mode (0=Self-Consumption, 1=Economy, 2=Backup, 3=Off-Grid, 4=Peak Shaving, 5=Time of Use)

Device listing endpoint (`/pvm/api/0/dev/select_by_page`) returns DTU, inverter, gateway, and battery info (serial, model, firmware, hardware) per station.

### Local API (HiBox gateway)

For local communication, the app connects to the HiBox-63T-G3 gateway over TCP (default port 10081) using protobuf-encoded messages. This is the same protocol used by the Hoymiles mobile app on your local network.

- No authentication required on the local network
- Messages use a binary frame with `HM` header, command ID, sequence number, and CRC-16/ARC checksum
- Real-time data, energy storage data, and battery mode control are all available locally
- The port is configurable in device settings (default: 10081)
- Polling interval: 60 seconds (aggressive polling below 30s can disrupt cloud connectivity)

### Modbus TCP (DTS-G3 stick)

As an alternative to the protobuf protocol, the app supports **Modbus TCP** communication on port 502. This is primarily used by the **DTS-G3** data transfer stick and other Hoymiles DTU devices that support the Modbus TCP interface.

- FC03 (Read Holding Registers) and FC04 (Read Input Registers) are supported
- Micro-inverter data is read from registers starting at 0x1000 (40 registers per PV port)
- Plant aggregate data (total power, daily/total energy) is read from registers at 0x2000
- ESS/battery data register addresses are firmware-dependent — use the **register scan diagnostic** in app settings to discover available data points
- If protobuf communication fails, the app automatically falls back to Modbus TCP

### Cloud login hardening

To protect your S-Miles Cloud account from repeated failed login attempts (which can trigger account lockout by Hoymiles), the app implements an exponential backoff strategy:

- **First failure**: 30-second wait before next attempt
- **Subsequent failures**: wait time doubles each time (30s → 60s → 120s → ...)
- **Account lockout detected**: 12-hour cooldown to prevent further damage
- **Successful login**: backoff resets immediately
- Backoff is also reset when you change credentials in device settings

## Known limitations

| Limitation | Detail |
|---|---|
| Unofficial API | May break if Hoymiles updates their backend or local protocol |
| Write operations | Only battery mode can be changed; charge limits and schedules are not yet supported |
| Device re-pair | Existing devices may need to be removed and re-added if new capabilities are missing after an update |
| HiOne only | Not tested with DTU, micro-inverters, or HYT series |
| Local polling | Intervals below 30 seconds can disrupt cloud and mobile app connectivity |
| Battery capacity | Battery runtime estimates assume 5 kWh usable capacity |

## Security considerations

- **Cloud credentials** are stored in Homey's encrypted device store and are only transmitted to the official Hoymiles S-Miles Cloud API (`neapi.hoymiles.com` and `euapi.hoymiles.com`). They are never sent to any third party.
- **Local communication** does not require authentication. Anyone on your local network with access to the HiBox gateway IP can read data and control the battery mode. This is a limitation of the HiBox gateway, not of this app.
- The password is hashed (Argon2id, SHA-256 or MD5, depending on the authentication profile) before being sent to the Hoymiles cloud API. The raw password is never transmitted.

### Signed power conventions

| Value | Meaning |
|---:|---|
| `battery_power > 0` | Battery charging |
| `battery_power < 0` | Battery discharging |
| `grid_power > 0` | Importing from grid |
| `grid_power < 0` | Exporting to grid |

Split positive values (`battery_charge_power`, `battery_discharge_power`, `grid_import_power`, `grid_export_power`) are derived from the signed values for easier use in Flows.

## Credits

This app is a co-creation between **Robert Coemans** and **Claude** (Anthropic), built using **[Windsurf](https://windsurf.com)** — an AI-powered IDE for collaborative software development.

If you like this, consider [buying me a coffee](https://buymeacoffee.com/kabxpqqg7z).

Pull requests and issue reports are welcome on [GitHub](https://github.com/rcoemans/com.hoymiles.hione).

## Acknowledgements

This Homey app builds on existing community efforts around the Hoymiles ecosystem.

- **Inspiration:** [Hoymiles HiOne — Homey App](https://github.com/ItsRaYnor/homey-app-hoymiles-hione)
- **Local protocol reference:** [hoymiles-wifi](https://github.com/suaveolent/hoymiles-wifi) — Python library for local DTU communication via protobuf (MIT)
- **Cloud API reference:** [homeassistant-hoymiles-cloud](https://github.com/Philra94/homeassistant-hoymiles-cloud) — Home Assistant integration for Hoymiles Cloud API
- **API documentation:** [hoymiles-api](https://github.com/Xinayder/hoymiles-api) — Reverse-engineered Hoymiles API docs
- **Modbus TCP reference:** [Hoymiles-Plant-DTU-Pro](https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro) — Hoymiles DTU-Pro Modbus TCP integration
- **Modbus TCP reference:** [ha-hoymiles-modbus-tcp](https://github.com/wil-lem/ha-hoymiles-modbus-tcp) — Hoymiles Modbus TCP integration for Home Assistant
