Monitor and control your Hoymiles HiOne battery system via Cloud, Modbus TCP and Protobuf.

FEATURES
- Multi-device architecture: Station, Inverter, Gateway, and Battery each appear as separate Homey devices
- Real-time monitoring: PV power, battery SoC, charge/discharge power, grid import/export, home load
- Energy totals: daily, monthly, yearly, and lifetime
- Financial and environmental: profit today/total, CO2 reduction
- Settable parameters: Battery mode, Reserve SoC, Max SoC, Max Charge/Discharge Power, Grid Limit
- Calculated insights: self-powered percentage, battery runtime, time-to-full, power balance
- Battery modes: Self-Consumption, Economy, Backup, Off-Grid, Force Charge, Force Discharge, Peak Shaving, Time of Use
- Three connection modes: Cloud Only, Hybrid (Cloud + Local LAN), Local Only
- Local protocols: Protobuf (port 10081) and Modbus TCP (port 502)
- Homey Energy integration: homeBattery with meter_power.charged/discharged
- Diagnostics: Modbus/Protobuf snapshot collector for data correlation and register discovery
- Flow triggers, conditions, and actions for full automation

REQUIREMENTS
- Homey Pro (2019 or 2023) with firmware >= 12.0.0
- Hoymiles HiOne BESS with HiBox or DTS gateway
- For cloud/hybrid mode: an active S-Miles Cloud account
- For local mode: the IP address of the gateway on your LAN

ADDING DEVICES
1. Open Homey and go to Devices
2. Tap + and search for "Hoymiles HiOne"
3. Add "HiOne Station" first — log in with your S-Miles Cloud credentials
4. Select your station from the list
5. Optionally configure local LAN connection
6. After the Station is added, add Inverter/Gateway/Battery devices linked to that station
7. Data refreshes every 60 seconds (configurable 30-300s)

AUTHENTICATION
Login uses the modern two-step v3 S-Miles Cloud flow: pre-inspect (nonce) + credential hash. Three client profiles are tried automatically (Web, S-Miles Installer, S-Miles Home). Argon2id salted accounts and legacy v0 MD5 fallback are supported. Passwords are hashed client-side — raw passwords are never sent.

DEVICE SETTINGS
Connection mode, gateway IP, protocol, port, poll interval, and cloud API URL can all be changed in the Station device settings without re-pairing. Default cloud API URL is https://neapi.hoymiles.com (auto-detected during login; S-Miles Home consumer accounts authenticate via euapi.hoymiles.com). System info (model, serial, firmware) is shown as read-only labels.

APP SETTINGS
The app settings page (Homey > Apps > Hoymiles HiOne > Settings) provides a cloud login test and diagnostics tools for Modbus TCP and Protobuf data correlation. Start/Stop/Export/Clear snapshot collection for register discovery and data analysis.

LANGUAGE
The app supports English and Dutch. Language is automatically set based on your Homey system language.

DISCLAIMER
This is an unofficial, community-developed integration. Not affiliated with or endorsed by Hoymiles Power Electronics Inc. Use at your own risk.
