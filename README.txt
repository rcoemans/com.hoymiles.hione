Monitor and control your Hoymiles HiOne all-in-one battery storage system from Homey.

FEATURES
- Real-time monitoring: PV power, battery state-of-charge, battery charge/discharge power, grid import/export (signed and split), home load, system alarm
- Energy totals: daily yield and lifetime total
- Calculated insights: self-powered percentage, battery runtime/time-to-full estimates, power balance, energy independence
- Battery mode control via Flows: Self-Consumption, Economy, Backup, Off-Grid, Peak Shaving, Time of Use
- Flow triggers: battery charging/discharging state changes, SoC thresholds, grid state changes, PV production, gateway status, connection source changes
- Flow conditions: battery charging/discharging, SoC above/below threshold, PV/load power thresholds, grid importing/exporting, battery mode, gateway online, connection local
- Flow actions: set battery mode, refresh data, prefer local/cloud, enable/disable cloud fallback
- Three connection modes: Local (LAN), Local + Cloud (recommended), or Cloud only
- Modbus TCP support for DTS-G3 sticks (port 502) — automatic fallback when protobuf is unavailable
- Homey Energy integration: battery charge/discharge power and cumulative energy count towards Homey Energy
- Cloud login hardening: backoff after failed attempts (up to 12h for account lockout) to protect your S-Miles account
- Register scan diagnostic: discover available Modbus registers from the app settings page

REQUIREMENTS
- Homey Pro (2019 or 2023) with firmware >= 10.0.0
- Hoymiles HiOne all-in-one BESS with HiBox-63T-G3 gateway (or DTS-G3 stick for Modbus TCP)
- For cloud/hybrid mode: an active S-Miles Cloud account
- For local mode: the IP address of the HiBox gateway on your LAN

ADDING A DEVICE
1. Open the Homey app and go to Devices
2. Tap + and search for "Hoymiles HiOne"
3. Select HiOne Station
4. Choose your connection mode:
   - Local (LAN): enter the IP address and port (default 10081) of your HiBox gateway
   - Local + Cloud: enter the gateway IP and port, then log in with your S-Miles Cloud credentials
   - Cloud only: log in with your S-Miles Cloud email and password
5. Select your station from the list
6. Data refreshes every 60 seconds

FINDING YOUR HIBOX IP ADDRESS
Check your router's admin page under connected devices. Look for a device named DTUBI-... or HiBox.
The local connection uses TCP port 10081 by default (configurable during pairing and in device settings).
Tip: use Local + Cloud for the most reliable experience.

DEVICE SETTINGS
After pairing, you can view and change your connection mode (Local, Hybrid, or Cloud only), S-Miles Cloud email and password, gateway IP/port, and poll interval in the device settings screen — no need to re-pair the device. The connection mode determines which data source the device uses. Gateway info (serial number, firmware, hardware version) is displayed read-only. The device tolerates up to 2 consecutive poll failures before marking itself unavailable (showing the specific error reason), and automatically recovers when the connection is restored.

APP SETTINGS
The app settings page (Homey > Apps > Hoymiles HiOne > Settings) lets you configure app-level defaults and view diagnostic logs. The logging section shows the last 200 log entries with buttons to refresh, copy, and clear. The diagnostics section includes a Modbus TCP register scan (uses the app-level Gateway IP) to discover available data points, with copy and clear buttons.

CLOUD DATA MAPPING
The S-Miles Cloud API returns real-time data in reflux_station_data:
  pv_power → PV power (W), bms_power → Battery power (W), bms_soc → Battery SoC (%),
  grid_power → Grid power (W), load_power → Home load (W).
Energy: today_eq → Daily energy (kWh), total_eq → Total energy (kWh).
Battery mode: tou_mode (0=Self-Consumption, 1=Economy, 2=Backup, etc).

FLOW CARDS
Actions:
- Set battery mode (Self-Consumption, Economy, Backup, Off-Grid, Peak Shaving, Time of Use)
- Refresh data now
- Prefer local/cloud connection
- Enable/disable cloud fallback

Conditions:
- Battery is/is not charging or discharging
- Battery SoC is/is not above or below threshold
- Grid is/is not importing or exporting power
- PV/load power is/is not above threshold
- Battery mode is/is not a specific mode
- Gateway is/is not online
- Connection is/is not local (LAN)

NOTE
Existing devices may need to be removed and re-added if new capabilities are missing after an update.

DISCLAIMER
This is an unofficial, community-developed integration. Not affiliated with or endorsed by Hoymiles Power Electronics Inc. Uses the reverse-engineered S-Miles Cloud API and/or local DTU communication. Hoymiles may change these interfaces at any time. Use at your own risk.
