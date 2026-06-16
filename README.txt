Monitor and control your Hoymiles HiOne all-in-one battery storage system from Homey.

FEATURES
- Real-time monitoring: PV power, battery state-of-charge, battery charge/discharge power, grid import/export (signed and split), home load, system alarm
- Energy totals: daily, monthly, yearly, and lifetime total
- Financial & environmental: profit today/total, CO2 reduction
- Settable battery parameters: Reserve SoC, Max SoC, Max Power, Grid Limit sliders on device card
- Calculated insights: self-powered percentage, battery runtime/time-to-full estimates, power balance, energy independence
- Battery mode control via Flows: Self-Consumption, Economy, Backup, Off-Grid, Self-Consumption + Max Power, Backup + Max Power, Peak Shaving, Time of Use
- Flow triggers: battery charging/discharging state changes, SoC thresholds, grid state changes, PV production, gateway status, connection source changes
- Flow conditions: battery charging/discharging, SoC above/below threshold, PV/load power thresholds, grid importing/exporting, battery mode, gateway online, connection local
- Flow actions: set battery mode, set reserve SoC, set max SoC, set max power, set grid limit, set peak shaving, set time-of-use period, set power limit, set inverter state, set relay, refresh data, prefer local/cloud, enable/disable cloud fallback
- Three connection modes: Local (LAN), Local + Cloud (recommended), or Cloud only
- Modbus TCP support for DTS-G3 sticks (port 502) — automatic fallback when protobuf is unavailable (PV power + validated energy only; ESS registers not mapped, unreliable data skipped to preserve cloud values)
- Homey Energy integration: homeBattery with meter_power.charged and meter_power.discharged for battery energy tracking
- Cloud login hardening: backoff after failed attempts (up to 12h for account lockout) to protect your S-Miles account
- Diagnostics: Quick Scan (known blocks), Deep Scan (full 0x0000–0xFFFF), ESS Probe (experimental battery register discovery)

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

DEVICE NAMING
The device name reflects the connection mode:
  Local:  {Plant name} (Local {IP})   e.g. Coemans (Local 192.168.1.116)
  Hybrid: {Plant name} (Hybrid {IP})   e.g. Coemans (Hybrid 192.168.1.116)
  Cloud:  {Plant name} (Cloud)         e.g. Coemans (Cloud)

DEVICE SETTINGS
After pairing, you can view and change your connection mode (Local, Hybrid, or Cloud only), S-Miles Cloud email and password, gateway IP/port, and poll interval in the device settings screen — no need to re-pair the device. The connection mode determines which data source the device uses. Device info sections (DTU, Inverter, Gateway/HiBox, Battery) show serial number, model, firmware and hardware versions (read-only, populated from cloud API and/or local gateway). The device tolerates up to 2 consecutive poll failures before marking itself unavailable (showing the specific error reason), and automatically recovers when the connection is restored.

APP SETTINGS
The app settings page (Homey > Apps > Hoymiles HiOne > Settings) lets you configure app-level defaults and view diagnostic logs. The logging section shows the last 200 log entries with buttons to refresh, copy, and clear. The diagnostics section includes three Modbus TCP tools (using the app-level Gateway IP):
  Quick Scan: checks known DTU-Pro register blocks + ESS candidate blocks
  Deep Scan: probes all 65,536 registers with ASCII decoding, signed interpretation, and FC03/FC04 testing
  ESS Probe: tests candidate battery/grid register blocks with strict plausibility validation
Note: Modbus TCP only provides confirmed PV power and validated energy data. The HiBox gateway does NOT follow the DTU-Pro register layout — unreliable energy values are automatically detected and skipped to preserve cloud data. Battery, grid, load, and mode require protobuf or cloud.

CLOUD DATA MAPPING
The S-Miles Cloud API returns real-time data in reflux_station_data:
  pv_power → PV power (W), bms_power → Battery power (W), bms_soc → Battery SoC (%),
  grid_power → Grid power (W), load_power → Home load (W).
Energy: today_eq → Daily energy (Wh integer → kWh), total_eq → Total energy (Wh integer → kWh).
Battery mode: tou_mode (1=Self-Consumption, 2=Economy, 3=Backup, 4=Off-Grid, 5=Self-Consumption + Max Power, 6=Backup + Max Power, 7=Peak Shaving, 8=Time of Use).
Device listing: /pvm/api/0/dev/select_by_page returns DTU, inverter, gateway, battery info per station.

FLOW CARDS
Actions:
- Set battery mode (Self-Consumption, Economy, Backup, Off-Grid, Self-Consumption + Max Power, Backup + Max Power, Peak Shaving, Time of Use)
- Set reserve SoC, max SoC, max power, grid limit
- Set peak shaving parameters (reserve SoC + max SoC + grid limit)
- Set time-of-use period (charge schedule)
- Set inverter power limit (2-100%, EEPROM write)
- Set inverter state (on/off)
- Set relay (enable/disable dry contact output)
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
Existing devices automatically migrate new capabilities on app update. Re-pairing is only needed if the device class changes.

DISCLAIMER
This is an unofficial, community-developed integration. Not affiliated with or endorsed by Hoymiles Power Electronics Inc. Uses the reverse-engineered S-Miles Cloud API and/or local DTU communication. Hoymiles may change these interfaces at any time. Use at your own risk.
