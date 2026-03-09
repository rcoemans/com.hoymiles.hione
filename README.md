# Hoymiles HiOne — Homey App

Monitor and control your **Hoymiles HiOne** all-in-one battery energy storage system (BESS) from Homey.

[![Homey App](https://img.shields.io/badge/Homey-App%20Store-00A94F?logo=homey)](https://homey.app/a/com.hoymiles.hione)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Disclaimer

> **This is an unofficial, community-developed integration.**
>
> - Not affiliated with, endorsed by, or supported by **Hoymiles Power Electronics Inc.**
> - Uses the reverse-engineered S-Miles Cloud API (`neapi.hoymiles.com`) and/or local DTU communication, neither of which are publicly documented.
> - Hoymiles may change or discontinue these interfaces at any time without notice — app functionality may break as a result.
> - Your **S-Miles Cloud credentials** are stored securely in Homey's encrypted device store. They are only sent to the official Hoymiles API and never to any third party.
> - Use at your own risk. The developers accept no liability for data loss, incorrect readings, or unintended battery mode changes.

---

## Features

- **Real-time monitoring**: PV power, battery state-of-charge, battery charge/discharge power, grid import/export, home load
- **Energy totals**: daily yield and lifetime total
- **Calculated insights**: self-powered percentage, battery runtime estimate, time-to-full estimate, power balance, energy independence state
- **Battery mode control** via Flows:
  - Self-Consumption, Economy, Backup, Off-Grid, Peak Shaving, Time of Use
- **Flow triggers**: battery started/stopped charging, battery started/stopped discharging, SoC changed, SoC crossed threshold, grid started importing/exporting, PV production started/stopped, gateway online/offline, connection source changed, battery mode changed
- **Flow conditions**: battery is/is not charging, battery is/is not discharging, SoC above/below threshold, PV power above threshold, load power above threshold, grid is/is not importing, grid is/is not exporting, battery mode is/is not, gateway is/is not online, connection is/is not local
- **Flow actions**: set battery mode, refresh data, prefer local/cloud connection, enable/disable cloud fallback
- **Three connection modes**:
  - **Local (LAN)** — direct connection to the HiBox gateway via IP (port 10081, protobuf). No cloud account needed. Works offline.
  - **Local + Cloud** — local as primary, S-Miles Cloud as fallback. Best reliability.
  - **Cloud only** — via S-Miles Cloud API. Requires a hoymiles.com account.
- **Connection source indicator**: see whether data comes from local or cloud

---

## Requirements

- Homey Pro (2019 or 2023) with firmware >= 10.0.0
- Hoymiles **HiOne** all-in-one BESS (tested: 3-phase models with HiBox-63T-G3 gateway)
- For cloud/hybrid mode: an active **S-Miles Cloud** account (the same credentials used in the Hoymiles app)
- For local mode: the IP address of the HiBox gateway on your LAN

> **Compatibility note**: This app was designed for the HiOne (HiBox-63T-G3 gateway). Other Hoymiles products (DTU, microinverters, HYT series) are *not* supported.

---

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

---

## Adding a device

After installing the app, you need to add a device to start monitoring your HiOne:

1. Open the Homey app on your phone
2. Go to **Devices** (bottom bar)
3. Tap the **+** button (top right) to add a new device
4. Search for **"Hoymiles HiOne"** or find it under the **Energy** category
5. Tap **HiOne Station**
6. Choose your connection mode:
   - **Local (LAN)** — enter the IP address of your HiBox gateway (find it in your router under connected devices, look for `DTUBI-...` or `HiBox`)
   - **Local + Cloud** — enter the gateway IP first, then log in with your S-Miles Cloud credentials
   - **Cloud only** — log in with your S-Miles Cloud email and password
7. Select your station from the list
8. Done — data refreshes every 60 seconds

### Finding your HiBox IP address

The HiBox-63T-G3 gateway connects to your local network via Ethernet. To find its IP:

- Check your router's admin page under connected/DHCP devices
- Look for a device named `DTUBI-...` or `HiBox`
- The local connection uses port **10081** (configured automatically)

> **Tip**: For the most reliable experience, choose **Local + Cloud**. The app will use your local network for fast data retrieval, and fall back to the cloud if the gateway is temporarily unreachable.

---

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
| Grid Power | Grid import (+) / export (-) power | W |
| Load Power | Current home consumption | W |
| Daily Energy | Energy produced today | kWh |
| Total Energy | Lifetime energy produced | kWh |
| Battery Mode | Current operating mode | — |
| Battery State | Charging / Discharging / Idle / Standby / Fault | — |
| Grid State | Importing / Exporting / Neutral | — |
| Connection Source | Local (LAN) or Cloud | — |
| Gateway Online | Whether the local gateway is reachable | — |
| System State | Online (local/cloud) / Degraded / Offline / Syncing / Error | — |
| Last Update | Timestamp of the last successful poll | — |

### Calculated capabilities

| Capability | Description | Unit |
|---|---|---|
| Self-Powered | Percentage of load covered by solar + battery | % |
| Battery Runtime | Estimated time until battery is empty (when discharging) | h |
| Time to Full | Estimated time until battery is fully charged (when charging) | h |
| Power Balance | PV + grid + battery - load | W |
| Energy Independence | Self-sufficient / Partly importing / Battery supported / Exporting surplus | — |

---

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

---

## Device settings

| Setting | Description | Default |
|---|---|---|
| Gateway IP address | Local LAN IP of the HiBox gateway (optional) | — |
| Cloud API URL | Base URL of the S-Miles Cloud API | `https://neapi.hoymiles.com` |
| Poll interval | How often to fetch data (30–300 seconds) | 60 |

---

## How it works

### S-Miles Cloud API

The app communicates with the Hoymiles cloud via the REST API at `neapi.hoymiles.com`. Authentication uses your S-Miles Cloud email and an MD5-hashed password. The token is valid for 24 hours and refreshes automatically.

Key endpoints:
- Login and authentication
- Station listing and real-time data (power flows, SoC, energy totals)
- Battery mode read/write

### Local API (HiBox gateway)

For local communication, the app connects to the HiBox-63T-G3 gateway over TCP port 10081 using protobuf-encoded messages. This is the same protocol used by the Hoymiles mobile app on your local network.

- No authentication required on the local network
- Messages use a binary frame with `HM` header, command ID, sequence number, and CRC16
- Real-time data, energy storage data, and battery mode control are all available locally
- Polling interval: 60 seconds (aggressive polling below 30s can disrupt cloud connectivity)

---

## Known limitations

| Limitation | Detail |
|---|---|
| Unofficial API | May break if Hoymiles updates their backend or local protocol |
| Write operations | Only battery mode can be changed; charge limits and schedules are not yet supported |
| HiOne only | Not tested with DTU, micro-inverters, or HYT series |
| Local polling | Intervals below 30 seconds can disrupt cloud and mobile app connectivity |
| Battery capacity | Battery runtime estimates assume 5 kWh usable capacity |

---

## Security considerations

- **Cloud credentials** are stored in Homey's encrypted device store and are only transmitted to the official Hoymiles S-Miles Cloud API (`neapi.hoymiles.com`). They are never sent to any third party.
- **Local communication** does not require authentication. Anyone on your local network with access to the HiBox gateway IP can read data and control the battery mode. This is a limitation of the HiBox gateway, not of this app.
- The password is **MD5-hashed** before being sent to the Hoymiles cloud API (as required by their API).

---

## Credits

This app is a co-creation between **Robert Coemans** and **Claude** (Anthropic), built using **[Windsurf](https://windsurf.com)** — an AI-powered IDE for collaborative software development.

If you like this, consider [buying me a coffee](https://buymeacoffee.com/kabxpqqg7z).

Pull requests and issue reports are welcome on [GitHub](https://github.com/rcoemans/com.hoymiles.hione).

## Acknowledgements

This Homey app builds on existing community efforts around the Hoymiles ecosystem.

- **Inspiration:** [Hoymiles HiOne — Homey App](https://github.com/ItsRaYnor/homey-app-hoymiles-hione)

---

## License

MIT — see [LICENSE](LICENSE)
