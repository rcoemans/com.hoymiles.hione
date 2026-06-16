# Improvement Areas — Based on ItsRaYnor/homey-app-hoymiles-hione Analysis

> **Source repo**: https://github.com/ItsRaYnor/homey-app-hoymiles-hione (v1.0.4)
>
> Each improvement has an **Action** field you can toggle:
> - `implement` — include in the next development cycle
> - `skip` — do not implement (with optional reason)
>
> Priority: 🔴 High | 🟡 Medium | 🟢 Low

Important: after all changes has been done also update README.md, README.txt and README.nl.txt accordingly if required!

---

## 1. Device Class — Change from `solarpanel` to `battery`

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our device class is `"class": "solarpanel"`.
**Reference**: Uses `"class": "battery"` — the correct Homey device class for a home battery / BESS system.

**What to change**:
- Change `class` from `"solarpanel"` to `"battery"` in `app.json` (driver definition).

**Expected benefit**:
- Homey recognizes the device as a home battery, enabling proper Energy dashboard integration.
- Battery-specific UI elements appear in the Homey app (charge/discharge indicators, battery icon).
- Required for `homeBattery` energy configuration (see improvement #2).

**Impact**: Existing devices must be re-added after this change.

---

## 2. Homey Energy Integration — `homeBattery` with charged/discharged meters

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our energy config is `{ "cumulative": true, "batteries": ["INTERNAL"] }`.
**Reference**: Uses proper Homey Home Battery integration:
```json
{
  "homeBattery": true,
  "meterPowerImportedCapability": "meter_power.charged",
  "meterPowerExportedCapability": "meter_power.discharged"
}
```

**What to change**:
- Add capabilities `meter_power.charged` and `meter_power.discharged` with `insights: true`.
- Update the energy config in the driver definition to use `homeBattery: true` with the imported/exported capability mapping.
- Map `batteryInEnergy` → `meter_power.charged` and `batteryOutEnergy` → `meter_power.discharged` in the poll cycle.
- Add `capabilitiesOptions` for these new capabilities with proper EN/NL titles.

**Expected benefit**:
- Battery charge/discharge energy is tracked in Homey's Energy dashboard.
- Users can see how much energy the battery has charged and discharged over time.
- Proper integration with Homey's energy management features.

---

## 3. Battery Mode IDs — Fix 0-based to 1-based numbering

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our battery modes use 0-based IDs (0=Self-Consumption, 1=Economy, etc.).
**Reference**: Uses 1-based IDs matching the S-Miles Cloud API (1=Self-Consumption, 2=Economy, etc.).

**What to change**:
- Update `BATTERY_MODES` in `HoymilesApi.js` to 1-based numbering.
- Update the `hione_battery_mode` capability enum values in `app.json` from `"0","1","2"...` to `"1","2","3"...`.
- Update all flow card mode dropdowns (`set_battery_mode`, `battery_mode_is`) to match 1-based IDs.
- Update the flow action/condition run listeners in `app.ts` and `driver.ts`.
- Update the mode comparison logic in `device.ts`.

**Expected benefit**:
- Mode IDs match the actual S-Miles Cloud API values — no translation layer needed.
- Correct mode names displayed in the Homey app.
- Prevents bugs when reading/writing battery modes via the cloud API.

**Impact**: Breaking change for existing flow cards using mode IDs. Users may need to re-select modes in existing flows.

---

## 4. Missing Battery Modes — Add modes 5 and 6 (Max Power variants)

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our app only exposes 6 modes (Self-Consumption, Economy, Backup, Off-Grid, Peak Shaving, Time of Use).
**Reference**: Exposes 8 modes:
1. Self-Consumption
2. Economy
3. Backup
4. Off-Grid
5. Self-Consumption + Max Power
6. Backup + Max Power
7. Peak Shaving
8. Time of Use

**What to change**:
- Add modes 5 ("Self-Consumption + Max Power") and 6 ("Backup + Max Power") to `hione_battery_mode` enum, `set_battery_mode` action dropdown, and `battery_mode_is` condition dropdown.
- Add EN/NL translations for both new modes.

**Expected benefit**:
- Users can select and monitor all battery modes their HiOne supports.
- Matches the S-Miles app functionality.

---

## 5. New Capabilities — Reserve SOC, Max SOC, Max Power, Grid Limit Sliders

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our app has no settable battery parameter controls.
**Reference**: Exposes interactive sliders on the device card:
- `hoymiles_reserve_soc` — Reserve SOC (battery minimum) — 0–100% slider
- `hoymiles_max_soc` — Max SOC (battery maximum) — 0–100% slider
- `hoymiles_max_power` — Max Power (charge/discharge limit) — 0–100% slider
- `hoymiles_meter_power` — Grid Power Limit (peak shaving) — 0–50000W slider

**What to change**:
- Add all four capabilities to `app.json` with `setable: true`, `uiComponent: "slider"`.
- Register capability listeners in `device.ts` to handle slider changes.
- Implement the corresponding API methods in `HoymilesApi.js`:
  - `getBatterySettings()` — async read via pvm-ctl job polling
  - `setReserveSoc()` — read-merge-write on active mode
  - `setMaxPower()` — targets Max Power modes (5/6)
  - `setMaxSoc()` — targets Peak Shaving (7) or active mode
  - `setGridLimit()` — Peak Shaving meter_power
- Add periodic settings refresh (every Nth poll) to keep slider values in sync.
- Handle Homey's 0–1 slider range vs API's 0–100% range conversion.

**Expected benefit**:
- Users can directly control battery parameters from the Homey device card.
- No need to open the S-Miles app to adjust reserve SOC, max power, etc.
- Real-time slider feedback as parameters change.

---

## 6. New Capabilities — Monthly Energy, Yearly Energy, CO₂ Reduction

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our app only tracks daily and total energy.
**Reference**: Also tracks:
- `hoymiles_monthly_energy` — Monthly energy (kWh)
- `hoymiles_yearly_energy` — Yearly energy (kWh)
- `hoymiles_co2_reduction` — CO₂ reduction (kg)

**What to change**:
- Add three new capabilities to `app.json`.
- Extract `month_eq`, `year_eq`, `co2_emission_reduction` from the cloud API `getRealData()` response.
- Map them in the poll cycle.

**Expected benefit**:
- Users get a complete energy production overview (daily/monthly/yearly/total).
- CO₂ reduction tracking provides environmental impact visibility.
- Insights data available for long-term charting.

---

## 7. New Capabilities — Financial Savings (Today / Total)

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: Tracks financial savings via the EPS profit endpoint:
- `hoymiles_profit_today` — Savings today (station currency)
- `hoymiles_profit_total` — Savings total (station currency)

**What to change**:
- Add two capabilities to `app.json`.
- Implement `getEpsProfit(stationId)` in `HoymilesApi.js` using the `/eps/api/0/record/stat_a` endpoint.
- Call it periodically (every Nth poll) alongside battery settings refresh.

**Expected benefit**:
- Users can see financial savings from their solar/battery system directly in Homey.
- Provides a tangible metric for return on investment.

---

## 8. New Flow Actions — Reserve SOC, Peak Shaving, Max Power, Max SOC, Grid Limit

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Only `set_battery_mode` action exists.
**Reference**: Has 7 additional flow actions:
- `set_reserve_soc` — Set reserve SOC percentage
- `set_peak_shaving` — Configure and activate Peak Shaving (reserve SOC + max SOC + grid limit)
- `set_max_power` — Set max charge/discharge power percentage
- `set_max_soc` — Set max SOC percentage
- `set_grid_limit` — Set grid power limit (W) for Peak Shaving

**What to change**:
- Add flow action definitions to `app.json` with proper args, hints, and EN/NL translations.
- Register run listeners in `driver.ts`.
- Implement corresponding methods in `device.ts` that delegate to the hybrid layer.
- Implement the cloud API methods (read-merge-write pattern) in `HoymilesApi.js`.

**Expected benefit**:
- Users can automate battery parameters via Homey Flows.
- Examples: "When electricity price drops below X, set reserve SOC to 100%" or "At sunset, activate Peak Shaving with 3000W grid limit".

---

## 9. New Flow Action — Time of Use Period

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: `set_tou_period` action with charge/discharge times, power percentages, and SOC limits.

**What to change**:
- Add the `set_tou_period` action to `app.json` with 8 args (charge_from, charge_to, charge_power, charge_soc, discharge_from, discharge_to, discharge_power, discharge_soc).
- Implement `setTouPeriod()` in `HoymilesApi.js` — constructs the period payload and activates ToU mode (8).
- Wire through hybrid layer and device.

**Expected benefit**:
- Users can set a single charge/discharge schedule via Homey Flows.
- Useful for dynamic tariff optimization: "At 23:00, start charging at 80% power until SoC 90%".

---

## 10. New Flow Action — Local Power Limit (with EEPROM Protection)

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: `set_power_limit` action with EEPROM wear protection:
- Limits inverter output (2–100%)
- Daily write budget (max 10 writes/day)
- Skip redundant writes (same value already set)
- Warning label about EEPROM wear

**What to change**:
- Add the `set_power_limit` action to `app.json`.
- Implement `setPowerLimit()` in `HoymilesLocal.js` (native protocol) and `HoymilesModbus.js` (register 0xC001).
- Add EEPROM protection in `device.ts`: track last-written value and daily write count in device store.
- Wire through hybrid layer (Modbus when active, native otherwise).

**Expected benefit**:
- Users can curtail inverter output via Flows (e.g., at negative electricity prices).
- EEPROM protection prevents wear from runaway automations.

---

## 11. New Flow Action — Inverter On/Off

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: `set_inverter_state` action — turns an inverter on/off by serial number (local) or all inverters (Modbus).

**What to change**:
- Add the `set_inverter_state` action to `app.json` with serial and state args.
- Implement in `HoymilesLocal.js` (native: by serial via CloudCommandResDTO) and `HoymilesModbus.js` (coil 0xC000).
- Wire through hybrid layer.

**Expected benefit**:
- Users can shut down inverters during negative price periods or for maintenance.
- Especially useful for dynamic energy tariff automations.

---

## 12. New Flow Action — Dry Contact / Relay Control

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: `set_relay` action — enables/disables the relay/dry contact output via cloud (action 1014).

**What to change**:
- Add action to `app.json`.
- Implement `getRelaySettings()` and `setRelayEnabled()` in `HoymilesApi.js` using action ID 1014.
- Read-preserve-write pattern to maintain existing relay settings.

**Expected benefit**:
- Users with compatible hardware can control the dry contact relay from Homey Flows.

---

## 13. API — Battery Settings Read/Write with Job Polling

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our `setBatteryMode()` does a simple direct write to `/pvm-ctl/api/0/dev/setting/write`.
**Reference**: Uses a proper async command pattern:
1. Write → returns a job ID
2. Poll `/pvm-ctl/api/0/dev/setting/status` until the job completes or fails
3. Read uses the same async pattern via `/pvm-ctl/api/0/dev/setting/read`

**What to change**:
- Add `SETTING_READ` and `SETTING_STATUS` endpoints to `HoymilesApi.js`.
- Implement `_resolveSettingJob()` — polls job status with configurable max polls and interval.
- Implement `getBatterySettings()` — reads the full settings payload with retry on "pending".
- Update `setBatteryMode()` to use the read-merge-write pattern with job polling.
- Handle the mode-data structure: `{ mode, data: { k_1: {...}, k_2: {...}, ... } }`.

**Expected benefit**:
- Battery mode changes are confirmed by the device (not fire-and-forget).
- Read-merge-write preserves existing settings (e.g., Economy schedules, ToU periods).
- Prevents overwriting user schedules when changing modes.
- Enables all the settable capabilities (reserve SOC, max power, etc.).

---

## 14. API — Cloud Energy Fields Expansion

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our `getRealData()` extracts `today_eq` and `total_eq`.
**Reference**: Also extracts:
- `month_eq` — monthly energy
- `year_eq` — yearly energy
- `co2_emission_reduction` — CO₂ savings (g → kg conversion)
- `reflux_station_data.bms_in_eq` — battery charged energy (Wh → kWh)
- `reflux_station_data.bms_out_eq` — battery discharged energy (Wh → kWh)

**What to change**:
- Expand `getRealData()` return object with `monthlyEnergy`, `yearlyEnergy`, `co2Reduction`, `batteryInEnergy`, `batteryOutEnergy`.
- Use the reference's `_kwh()` conversion (Wh → kWh with 2dp rounding).

**Expected benefit**:
- More data available for capabilities and insights without additional API calls.
- Battery in/out energy enables the `meter_power.charged/.discharged` capabilities.

---

## 15. API — EPS Profit/Savings Endpoint

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: `getEpsProfit()` calls `/eps/api/0/record/stat_a` → returns `{ todayProfit, monthlyProfit, yearlyProfit, totalProfit }`.

**What to change**:
- Add the endpoint to `HoymilesApi.js`.
- Call it periodically (every 5th poll) alongside battery settings.
- Map to `hoymiles_profit_today` and `hoymiles_profit_total` capabilities.

**Expected benefit**:
- Financial savings visibility in Homey.

---

## 16. API — Auth Cooldown for Fatal Errors

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our API has exponential backoff, but no specific fatal-error detection.
**Reference**: Distinguishes between normal auth failures (30min cooldown) and fatal errors (12h cooldown) based on patterns:
- `daily maximum` / `exceeds the daily` → account lockout
- `installer/administrator` → wrong account type
- `check your account and password` → bad credentials

**What to change**:
- Add `FATAL_AUTH_PATTERNS` regex list to `HoymilesApi.js`.
- In the auth failure handler, check if any pattern matches and apply the longer cooldown.
- Log a clear message: "Fatal auth error — backing off 12h to protect the account".

**Expected benefit**:
- Protects user accounts from being locked by Hoymiles due to repeated failed login attempts.
- Prevents hammering the API when credentials are wrong or account type is incompatible.

---

## 17. API — Station Setting Rules

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: `getSettingRules()` calls `/pvm/api/0/station/setting_rule` — returns the cloud's declaration of supported controls/modes/ranges.

**What to change**:
- Add `SETTING_RULE` endpoint.
- Implement `getSettingRules()`.
- Surface in the diagnostics output.

**Expected benefit**:
- Helps diagnose which modes/controls a specific HiOne installation actually supports.
- Useful for the app settings diagnostics view.

---

## 18. Hybrid Layer — Cloud Energy Top-Up for Local Data

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our hybrid layer fetches from cloud if local fails, but doesn't merge local+cloud data.
**Reference**: `_mergeCloudEnergy()` — every 5th poll when using local data, tops up missing fields from the cloud:
- `dailyEnergy`, `monthlyEnergy`, `yearlyEnergy`, `totalEnergy`
- `co2Reduction`, `batteryInEnergy`, `batteryOutEnergy`

**What to change**:
- Add `_mergeCloudEnergy()` to `HoymilesHybrid.js`.
- Call it after successful local data retrieval when cloud credentials are available.
- Only top up fields that are null/undefined in local data.

**Expected benefit**:
- Local data gets enriched with energy counters that are only available from the cloud.
- Best of both worlds: real-time local data + accurate energy totals from cloud.

---

## 19. Hybrid Layer — Battery Settings via Cloud

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our hybrid layer has basic `setBatteryMode()` but no settings read/refresh.
**Reference**: Proxies all settings operations through the hybrid layer:
- `getBatterySettings()` — reads current settings from cloud
- `setReserveSoc()`, `setMaxPower()`, `setMaxSoc()`, `setGridLimit()` — all via cloud
- `setTouPeriod()` — Time of Use via cloud
- `setRelayEnabled()` — relay control via cloud
- `getEpsProfit()` — EPS savings from cloud

**What to change**:
- Add all proxy methods to `HoymilesHybrid.js` that delegate to the cloud API with `ensureToken()`.
- Return `null` when cloud is not available (local-only mode).

**Expected benefit**:
- Clean separation of concerns: device.ts calls hybrid, hybrid handles routing.
- All cloud-only operations properly guarded with availability checks.

---

## 20. Device — Capability Migration on Existing Devices

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Unknown if our app handles adding/removing capabilities on existing devices.
**Reference**: `_migrateCapabilities()` runs on device init:
- Adds `NEW_CAPABILITIES` that are missing from existing devices.
- Removes `REMOVED_CAPABILITIES` that are no longer needed.

**What to change**:
- Add a `_migrateCapabilities()` method to `device.ts`.
- Maintain a `NEW_CAPABILITIES` list for capabilities added after the initial release.
- Maintain a `REMOVED_CAPABILITIES` list for deprecated capabilities.
- Call at the start of `onInit()`.

**Expected benefit**:
- Existing devices automatically get new capabilities without re-pairing.
- Deprecated capabilities are cleaned up automatically.
- Smooth upgrade path for users updating the app.

---

## 21. Device — Periodic Battery Settings Refresh

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Not implemented.
**Reference**: Every 5th poll, refreshes battery settings from cloud:
- Active mode + reserve SOC
- Max power, max SOC, grid limit (for sliders)
- EPS profit counters

**What to change**:
- Add `_refreshBatterySettings()` to `device.ts`.
- Trigger it every `SETTINGS_POLL_EVERY` polls.
- Also trigger after any capability listener changes a setting.
- Map results to the settable slider capabilities.

**Expected benefit**:
- Slider values stay in sync with the actual device state.
- Changes made in the S-Miles app are reflected in Homey.

---

## 22. Device — Gateway Info Fetch and Display

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Device settings show DTU/inverter/gateway/battery info groups, but may not populate them from local.
**Reference**: `_fetchGatewayInfo()` probes the local gateway and updates device settings:
- `dtu_serial` — DTU serial number
- `firmware_version` — firmware version
- `hardware_version` — hardware version

**What to change**:
- Ensure `_fetchGatewayInfo()` is called after local probe succeeds.
- Map the results to the appropriate device settings fields.

**Expected benefit**:
- Users can see gateway hardware/firmware info in the device settings.
- Useful for support and diagnostics.

---

## 23. Pairing — Network Scan for Gateway Discovery

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Users must manually enter the gateway IP.
**Reference**: `NetworkScan.js` discovers gateways automatically:
- Sweeps /24 subnet for ports 10081 (native) and 502 (Modbus)
- Verifies hits with protocol handshake
- Returns verified/unverified device list with IP, port, protocol, DTU serial
- Bounded concurrency (32 parallel probes)
- 400ms timeout per probe

**What to change**:
- Add `NetworkScan.js` (or equivalent) to `lib/`.
- Add a `scan_network` handler to the pairing session.
- Add a "Scan network" button to the gateway_ip pairing page.
- Show discovered devices in a list; user can select one or enter manually.

**Expected benefit**:
- Users don't need to know their gateway's IP address.
- Reduces pairing friction significantly.
- Detects which protocol (native vs Modbus) the gateway supports.

---

## 24. Pairing — Saved Login Reuse

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Users must enter credentials every time they pair a new device.
**Reference**: Supports saved login:
- `get_saved_login` → returns { email } if saved
- `login_saved` → re-authenticates with saved credentials
- `forget_login` → clears saved credentials
- Saved IP is also prefilled from previous pairing

**What to change**:
- Add handlers to the pairing session in `driver.ts`.
- Show a "Saved account: X" message in the login page with a "Use saved" button.
- Store credentials in `homey.settings` (app-level).

**Expected benefit**:
- Faster pairing for users with multiple devices or re-pairings.
- One-tap login after first setup.

---

## 25. App Settings — Battery Mode Diagnostics

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our settings page has Modbus diagnostics but no cloud diagnostics.
**Reference**: "Show supported battery modes" button that:
- Logs in with saved credentials
- Fetches `getBatterySettings()` and `getSettingRules()`
- Shows which modes the device supports vs. which the app offers
- Displays raw mode data and setting rules

**What to change**:
- Add a `/diagnostics` API endpoint in `api.js`.
- Add a diagnostics button to `settings/index.html`.
- Implement the diagnostics logic: fetch stations, settings, rules; format output.

**Expected benefit**:
- Users and support can quickly verify which battery modes their system supports.
- Helps diagnose mode-switching issues.
- Shows the raw cloud data for troubleshooting.

---

## 26. App Settings — LAN Protocol Selection

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our settings page doesn't have a protocol selector.
**Reference**: Settings page has:
- Protocol dropdown: Auto / Modbus TCP (DTS-G3) / Hoymiles native (10081)
- Port input (default based on protocol)
- Modbus unit ID input (101–254)
- Help text for enabling Modbus on the DTS-G3

**What to change**:
- Add a protocol selector to `settings/index.html`.
- Store `local_protocol` in app settings.
- Pass through to the hybrid layer for transport selection.
- Add Modbus help text (RS485 Port Config → Remote Control).

**Expected benefit**:
- Users with DTS-G3 sticks can easily switch to Modbus.
- Clear guidance on how to enable Modbus on the stick.

---

## 27. App Settings — Language Toggle

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: Our settings page may not have a language toggle.
**Reference**: Small EN/NL toggle button in the header with full inline i18n.

**What to change**:
- Add language toggle to `settings/index.html`.
- Create an inline `i18n` object with all translatable strings in EN and NL.
- Apply translations dynamically on toggle.

**Expected benefit**:
- Dutch users can switch to their language on the settings page.
- Consistent with the pairing pages that already support language switching.

---

## 28. App Settings — Cloud Account Login/Forget

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Cloud credentials are per-device in device settings.
**Reference**: App-level settings page with:
- Email + password login form
- "Log in & save" button with status feedback
- "Saved account: X" display with "Forget account" link
- Credentials stored at app level, reused across pairings

**What to change**:
- Add cloud account section to `settings/index.html`.
- Add `/login` and `/logout` API endpoints in `api.js`.
- Store credentials in `homey.settings` (app-level).
- Show saved account status.

**Expected benefit**:
- One-time login on the settings page, then pairing uses saved credentials.
- Easy credential management (forget/re-login).

---

## 29. Modbus — DTS-G3 Control Registers

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our `ModbusTcpClient.js` focuses on read-only data.
**Reference**: `HoymilesModbus.js` implements control:
- `setPowerLimit()` — write register 0xC001 (FC06, 2–100%)
- `setInverterState()` — write coil 0xC000 (FC05, on/off)
- These are documented in the Hoymiles Modbus Technical Note V1.2.

**What to change**:
- Add `FC.WRITE_COIL` (0x05) and `FC.WRITE_SINGLE` (0x06) to `ModbusTcpClient.js`.
- Implement `setPowerLimit()` and `setInverterState()` methods.
- Wire through the hybrid layer (Modbus when active).

**Expected benefit**:
- Local control of inverter power limit and on/off state via Modbus.
- No cloud dependency for these operations.

---

## 30. Local Protocol — Energy Storage Data (ES Commands)

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our `HoymilesLocal.js` may not implement ES (Energy Storage) commands.
**Reference**: Full ES command implementation:
1. `getGatewayInfo()` — extended frame → DTU serial
2. `getInverterSerial()` — ES registry → inverter serial(s)
3. `getEnergyStorageData()` — ES data → live battery/grid/load/PV flows with phase summing
4. `setBatteryMode()` — ES user set for modes 1, 3, 4

**What to change**:
- Verify our `HoymilesLocal.js` implements the ES command chain.
- Add/fix `getEnergyStorageData()` with proper field extraction:
  - PV power (field 4), battery BMS (field 9: SoC=4, power=8, in=17, out=18)
  - Grid phases (field 10), load phases (field 11), flow data (field 17)
- Add phase-summing for grid and load power.
- Ensure 2s minimum request spacing to avoid stick confusion.

**Expected benefit**:
- Complete local data from the HiOne hybrid — battery, grid, load, PV.
- No cloud dependency for real-time monitoring.

---

## 31. Local Protocol — Local Battery Mode Setting

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Battery mode changes go through cloud only.
**Reference**: Modes 1 (Self-Use), 3 (Backup), 4 (Off-Grid) can be set locally via ES user set command.

**What to change**:
- Implement `setBatteryMode()` in `HoymilesLocal.js` using the ES user set extended frame.
- Define `LOCAL_SETTABLE_MODES = [1, 3, 4]`.
- In the hybrid layer, attempt local first for these modes, fall back to cloud.

**Expected benefit**:
- Faster mode changes for supported modes (no cloud round-trip).
- Works when cloud is unavailable.

---

## 32. Hybrid Layer — Modbus Transport Selection

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Our hybrid layer may not properly handle Modbus as an alternative to native.
**Reference**: Three transport modes:
- `auto` — probe both, prefer native, use confirmed Modbus
- `native` — only native (10081)
- `modbus` — only Modbus (502)

**What to change**:
- Add `_protocol` field to `HoymilesHybrid.js`.
- Add `_modbusActive()` check: returns true when protocol is 'modbus' or Modbus is confirmed.
- In `getData()`, check Modbus first when active.
- In `probeLocal()`, check Modbus reachability and confirm it.
- Route control operations (power limit, inverter state) through the active transport.

**Expected benefit**:
- Users with DTS-G3 sticks get proper Modbus-only operation.
- Auto mode tries both protocols and remembers which works.

---

## 33. API — Paginated Station Listing

**Priority**: 🟢 Low
**Action**: `implement`
**Skip reason**: Most users have 1–2 stations. Current single-page fetch is sufficient.

**Reference**: Loops with `page_num` and `page_size` until all stations are fetched.

---

## 34. API — `fetch()` vs `HttpClient.js`

**Priority**: 🟢 Low
**Action**: `implement`
**Skip reason**: Our `HttpClient.js` was created specifically because `fetch()` is not available in all Homey runtimes. The reference may not work on older Homey firmware.

**Reference**: Uses native `fetch()` with `AbortSignal.timeout()`.

---

## 35. Capability — `measure_power` Mapping

**Priority**: 🔴 High
**Action**: `implement`

**Current state**: Our `measure_power` is mapped to PV power.
**Reference**: `measure_power` is mapped to **battery power** (+ charge / − discharge). PV power uses a separate `hoymiles_pv_power` capability.

**What to change**:
- Change `measure_power` mapping from PV power to battery power.
- The `measure_power` capability is the primary power indicator for a battery device class.
- Keep `hione_pv_power` for PV power (already exists).
- Update `capabilitiesOptions` title to "Battery Power (+ charge / − discharge)".

**Expected benefit**:
- Correct Homey Energy integration — `measure_power` reflects battery charge/discharge.
- Proper power flow display on the device card.
- Matches the `battery` device class expectations.

---

## 36. Device — `onSettings` Handler for Runtime Config Changes

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: Unknown if settings changes are handled at runtime.
**Reference**: `onSettings()` handler:
- Reinitializes hybrid layer when `gateway_ip` or `cloud_api_url` changes.
- Restarts polling when `poll_interval` changes.

**What to change**:
- Add/verify `onSettings()` handler in `device.ts`.
- Reinitialize connections on relevant setting changes.
- Restart polling interval on change.

**Expected benefit**:
- Users can change settings without restarting the app or re-pairing.
- Immediate effect of configuration changes.

---

## 37. Device — Battery Mode Change Trigger with Mode Name Token

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: We fire `battery_mode_changed` but may not include a human-readable mode name token.
**Reference**: Fires the trigger with `{ mode: modeName }` where `modeName` is the human-readable string (e.g., "Self-Consumption").

**What to change**:
- Verify the trigger token includes the mode name (not just the numeric ID).
- Use `BATTERY_MODES[Number(mode)]` to convert.
- Track previous mode to only fire on actual changes.

**Expected benefit**:
- Flow trigger tokens show readable mode names, not numeric IDs.
- Users can use the token in notifications: "Battery mode changed to Self-Consumption".

---

## 38. Changelog — `.homeychangelog.json`

**Priority**: 🟢 Low
**Action**: `implement`

**Current state**: May not have a changelog file.
**Reference**: Maintains `.homeychangelog.json` with EN/NL descriptions per version.

**What to change**:
- Create/update `.homeychangelog.json` with proper version entries.
- Include descriptions for each release in EN and NL.

**Expected benefit**:
- Users see release notes in the Homey App Store.
- Clear communication of changes per version.

---

## 39. Percentage Field Handling — Cloud API 0.01% Units

**Priority**: 🟡 Medium
**Action**: `implement`

**Current state**: May not handle the cloud's percentage encoding correctly.
**Reference**: `_pct()` method handles values > 100 as being in 0.01% units:
```js
_pct(v) {
  if (v > 100) return Math.round(v / 100);
  return Math.round(v);
}
```

**What to change**:
- Add/verify a `_pct()` helper in `HoymilesApi.js`.
- Use it for `reserve_soc`, `max_power`, `max_soc` fields from battery settings.
- Device sliders use Homey's 0–1 range; convert with `_percentToCap()` (÷100) and `_capToPercent()` (×100).

**Expected benefit**:
- Correct percentage display — prevents sliders showing 100x too high.
- Handles both 0–100 and 0–10000 encoding from the cloud.

---

## Summary

| # | Area | Priority | Action |
|---|------|----------|--------|
| 1 | Device class → battery | 🔴 High | `implement` |
| 2 | Homey Energy (homeBattery) | 🔴 High | `implement` |
| 3 | Battery mode IDs (1-based) | 🔴 High | `implement` |
| 4 | Missing battery modes (5, 6) | 🟡 Medium | `implement` |
| 5 | Settable sliders (SOC, power, grid) | 🔴 High | `implement` |
| 6 | Monthly/yearly energy + CO₂ | 🟡 Medium | `implement` |
| 7 | Financial savings | 🟢 Low | `implement` |
| 8 | Flow actions (SOC, peak shaving, etc.) | 🔴 High | `implement` |
| 9 | Flow action: Time of Use period | 🟡 Medium | `implement` |
| 10 | Flow action: Local power limit | 🟡 Medium | `implement` |
| 11 | Flow action: Inverter on/off | 🟡 Medium | `implement` |
| 12 | Flow action: Relay/dry contact | 🟢 Low | `implement` |
| 13 | API: Battery settings job polling | 🔴 High | `implement` |
| 14 | API: Cloud energy fields expansion | 🟡 Medium | `implement` |
| 15 | API: EPS profit endpoint | 🟢 Low | `implement` |
| 16 | API: Fatal auth cooldown | 🟡 Medium | `implement` |
| 17 | API: Station setting rules | 🟢 Low | `implement` |
| 18 | Hybrid: Cloud energy top-up | 🟡 Medium | `implement` |
| 19 | Hybrid: Battery settings proxy | 🔴 High | `implement` |
| 20 | Device: Capability migration | 🟡 Medium | `implement` |
| 21 | Device: Battery settings refresh | 🟡 Medium | `implement` |
| 22 | Device: Gateway info fetch | 🟢 Low | `implement` |
| 23 | Pairing: Network scan | 🟡 Medium | `implement` |
| 24 | Pairing: Saved login reuse | 🟢 Low | `implement` |
| 25 | Settings: Battery mode diagnostics | 🟡 Medium | `implement` |
| 26 | Settings: LAN protocol selection | 🟡 Medium | `implement` |
| 27 | Settings: Language toggle | 🟢 Low | `implement` |
| 28 | Settings: Cloud account login | 🟡 Medium | `implement` |
| 29 | Modbus: DTS-G3 control registers | 🟡 Medium | `implement` |
| 30 | Local: ES data commands | 🔴 High | `implement` |
| 31 | Local: Battery mode setting | 🟡 Medium | `implement` |
| 32 | Hybrid: Modbus transport selection | 🟡 Medium | `implement` |
| 33 | API: Paginated stations | 🟢 Low | `implement` |
| 34 | API: fetch() vs HttpClient | 🟢 Low | `implement` |
| 35 | Capability: measure_power → battery | 🔴 High | `implement` |
| 36 | Device: onSettings handler | 🟡 Medium | `implement` |
| 37 | Device: Mode trigger with name | 🟢 Low | `implement` |
| 38 | Changelog file | 🟢 Low | `implement` |
| 39 | API: Percentage field handling | 🟡 Medium | `implement` |
