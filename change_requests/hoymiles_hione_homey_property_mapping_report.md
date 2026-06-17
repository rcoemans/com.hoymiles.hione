# Hoymiles HiOne Homey App Property Mapping Report

**Purpose:** map the Homey HiOne Station app properties to (1) Hoymiles API / Cloud data and (2) Modbus TCP / Local LAN data, and explain what every property means.

**Context:** The Homey app currently exposes sliders, operating-mode options and capabilities for a Hoymiles HiOne system. The uploaded screenshots and logs show that the Hoymiles API data correlates well with S-Miles Cloud, while the current Modbus TCP mapping is technically connected but not yet a reliable source for HiOne ESS values.

---

## 1. Executive summary

The most important conclusion is:

> **Use the Hoymiles API / Cloud as the reliable source for production Homey capabilities. Treat Modbus TCP as experimental until the correct HiOne-specific register map is confirmed.**

The API logs show realistic data:

```text
pv=0
bat=1150
soc=92
grid=-5
load=951
daily=47.8
total=111.6
mode=1000
```

These values match the Homey cloud screenshots and S-Miles Cloud screenshots.

The Modbus TCP logs show this recurring local data:

```text
pv=0
bat=0
soc=0
grid=0
load=0
daily=0
total=613426.32
mode=0
```

The local value `613426.32 kWh` is invalid. It must not be published to Homey. It likely comes from interpreting identity/header registers as an energy counter.

---

## 2. Device hierarchy observed in S-Miles Cloud

```text
Plant: Coemans
Plant type: PV String + Battery
Plant ID: 14076570

DTU / Data Transfer Stick
SN: 430526031404
Model: DTS-WL-G3
Hardware: H11.02.01
Firmware: V03.00.13
│
└── Inverter
    SN: 228326070238
    Model: HiOne-16T-G3
    Hardware: H1.01.00
    Firmware: V00.01.35
    │
    ├── Gateway
    │   SN: 28E026139783
    │   Model: HiBox-63T-G3
    │   Hardware: V00.00.00
    │   Firmware: V00.01.08
    │
    ├── Battery module SN: 23C02621015E
    ├── Battery module SN: 23C026210191
    ├── Battery module SN: 23C0262100E3
    └── Battery module SN: 23C0262100E2
```

---

## 3. Recommended source strategy

| Data category | Preferred source now | Reason |
|---|---|---|
| Device hierarchy | Cloud/API | Visible and reliable in S-Miles |
| Serial numbers | Cloud/API | Confirmed in S-Miles device pages |
| Firmware versions | Cloud/API | Confirmed in S-Miles device pages |
| Hardware versions | Cloud/API | Confirmed in S-Miles device pages |
| Realtime power values | Cloud/API | API values match S-Miles/Homey |
| Energy totals | Cloud/API | Local Modbus total is invalid |
| Operating mode | Cloud/API | `mode=1000` correlates with Self-Consumption |
| Local connection status | Modbus TCP | Modbus connection itself is useful |
| Local realtime telemetry | Modbus TCP | Experimental only |
| Configuration writes | Cloud/API | Do not write via Modbus without official register map |

---

## 4. Sliders

| App property | Type | Description | Hoymiles API / Cloud mapping | Modbus TCP / Local LAN mapping | Advice |
|---|---|---|---|---|---|
| Reserve SoC | Slider | Minimum battery percentage to keep in reserve. The system should avoid discharging below this level. | Likely cloud configuration setting. Direct API field not confirmed in supplied logs. | Unknown. No confirmed register. | Use Cloud/API only. Do not write via Modbus yet. |
| Max SoC | Slider | Maximum battery charge percentage. | Likely cloud configuration setting. Direct API field not confirmed. | Unknown. | Use Cloud/API only. |
| Max Power | Slider | Maximum charge/discharge power limit used by some modes. | Likely cloud configuration setting. Direct API field not confirmed. | Unknown. | Use Cloud/API only and validate allowed range. |
| Grid Power Limit | Slider | Limit related to grid import/export or peak-shaving threshold. | Likely cloud configuration setting. Direct API field not confirmed. | Unknown. | Use Cloud/API only. Clarify whether it limits import, export or peak shaving. |

**Implementation note:** sliders are write/configuration operations. They need strict validation and a read-back check after writing.

---

## 5. Operating mode options

| App property | Type | Description | Hoymiles API / Cloud mapping | Modbus TCP / Local LAN mapping | Advice |
|---|---|---|---|---|---|
| Self-Consumption | Option | Prioritises using PV and battery for own consumption. | Probable: API `mode=1000`, matching S-Miles `Self-Consumption Mode`. | Unknown. | Use Cloud/API. |
| Economy | Option | Optimises operation for cost/tariffs. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API. |
| Backup | Option | Keeps battery energy available for backup. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API. |
| Off-Grid | Option | Operation without grid dependency. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API with safeguards. |
| Self-Consumption + Max Power | Option | Self-consumption mode with a power limit. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API. |
| Backup + Max Power | Option | Backup mode with a power limit. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API. |
| Peak Shaving | Option | Uses battery to reduce grid demand peaks. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API. |
| Time of Use | Option | Runs according to time/tariff schedule. | Cloud mode likely, code unknown. | Unknown. | Use Cloud/API. |

Recommended partial mode map:

```javascript
const operatingModeMap = {
  1000: 'Self-Consumption',
  // TODO: discover Economy, Backup, Off-Grid, Peak Shaving, Time of Use, etc.
};
```

---

## 6. Capability mapping overview

| App property | Type | Clear description | Hoymiles API / Cloud mapping | Modbus TCP / Local LAN mapping | Status / advice |
|---|---|---|---|---|---|
| Battery Power | Capability | Current battery power. In your API data, positive values currently appear to represent charging. | Confirmed: API raw `bat`, e.g. `bat=1150`. | Current local value returns `0` while cloud/S-Miles shows non-zero. | Use API. Local experimental only. |
| Total Energy Generated | Capability | Lifetime generated energy shown by S-Miles/Homey. | Confirmed: API raw `total=111.6`. | Invalid current value `613426.32 kWh`. | Use API only. Disable local mapping. |
| Energy Charged | Capability | Battery energy charged. Period must be clarified: daily, lifetime or session. | Likely API/statistics. S-Miles day view has `Charge 25.8 kWh`. | Unknown. | Use API/statistics. Clarify period. |
| Energy Discharged | Capability | Battery energy discharged. Period must be clarified. | Likely API/statistics. S-Miles day view has `Discharge 3.3 kWh`. | Unknown. | Use API/statistics. Clarify period. |
| PV Power | Capability | Current PV production power. | Confirmed: API raw `pv`, e.g. `pv=0`. | Not proven. Local `0` may be true at night but not a confirmed mapping. | Use API. Test local during daytime. |
| Grid Power | Capability | Current grid power. Negative appears to indicate export; positive likely import. | Confirmed: API raw `grid`, e.g. `grid=-5`. | Current local value `0` while cloud shows non-zero. | Use API. |
| Load Power | Capability | Current household/load consumption. | Confirmed: API raw `load`, e.g. `load=951`. | Current local value `0` while cloud shows non-zero. | Use API. |
| Daily Energy | Capability | Energy generated today. | Confirmed: API raw `daily=47.8`; S-Miles `Energy Today 47.8 kWh`. | Current local value `0`. | Use API. |
| Monthly Energy | Capability | Energy generated this month. | S-Miles shows `Energy This Month 111.6 kWh`; raw API field not shown in logs. | Unknown. | Add API/statistics mapping. |
| Yearly Energy | Capability | Energy generated this year. | S-Miles shows `Energy This Year 111.6 kWh`; raw API field not shown in logs. | Unknown. | Add API/statistics mapping. |
| Total Energy | Capability | Lifetime energy. Same or similar to Lifetime Energy. | Confirmed: API raw `total=111.6`. | Invalid current local value `613426.32 kWh`. | Use API only. |
| CO2 Reduction | Capability | Estimated CO₂ reduction. | S-Miles shows `CO2 Emission Reduction 111.27 kg`; can be API or calculated. | Not a Modbus value. | Use API or app calculation. |
| Profit Today | Capability | Estimated financial profit today. | Cloud/API if price is configured; S-Miles says price not set. | Not a Modbus value. | Use cloud or app-side tariff calculation. |
| Profit Total | Capability | Estimated total financial profit. | Cloud/API if price is configured. | Not a Modbus value. | Use cloud or app-side calculation. |
| Battery Charge Power | Capability | Current power going into battery. | Derived from API `bat`: if `bat > 0`, charge = `bat`. | Current local value `0`. | Use API. Confirm sign during discharge. |
| Battery Discharge Power | Capability | Current power coming out of battery. | Derived from API `bat`: if `bat < 0`, discharge = `abs(bat)`. | Current local value `0`. | Use API. Confirm sign convention. |
| Grid Import Power | Capability | Current power imported from grid. | Derived from API `grid`: if `grid > 0`, import = `grid`. | Current local value `0`. | Use API. |
| Grid Export Power | Capability | Current power exported to grid. | Derived from API `grid`: if `grid < 0`, export = `abs(grid)`. | Current local value `0`. | Use API. |
| Battery State | Capability | Human-readable battery state: Charging, Discharging, Idle. | Derived from API `bat` or from S-Miles battery status. | Current local state is derived from zero and therefore not reliable. | Use API. Add deadband. |
| Grid State | Capability | Human-readable grid state: Importing, Exporting, Neutral. | Derived from API `grid`. | Current local state is derived from zero and therefore not reliable. | Use API. |
| Generic Alarm | Capability | General alarm flag. `No` means no active alarm. | Cloud/S-Miles system or alarm status; S-Miles shows Normal. | Unknown. | Use Cloud/API. |
| Self-Powered | Capability | Percentage of consumption covered by PV/battery instead of grid import. | API or calculated from API load/grid. Current app shows 100%. | Not reliable because local grid/load are zero. | Use API or calculate from reliable API values. |
| Battery Runtime | Capability | Estimated time battery can continue supplying load until reserve. | Calculated from SOC, reserve SoC, capacity and discharge power. | Unknown. | Calculate from API only for now. |
| Time to Full | Capability | Estimated time until battery reaches max SoC while charging. | Calculated from SOC, max SoC, capacity and charge power. | Unknown. | Calculate from API only for now. |
| Power Balance | Capability | Balance between supply and demand. | Derived from API values. In screenshot: `194 W` from near `bat=1150`, `grid=-5`, `load=951`, `pv=0`. | Not reliable because local values are zero. | Use API; document formula. |
| Energy Independence | Capability | Human-readable autonomy state such as Self-Sufficient or Exporting Surplus. | Derived from grid/self-powered/battery/PV API values. | Not reliable because local values are zero. | Use API. |
| System State | Capability | Online/offline state for selected data source. | App-level status from API polling, e.g. `Online (Cloud)`. | App-level status from Modbus connection, e.g. `Online (Local)`. | Works as app-level source state. |
| Connection Source | Capability | Indicates Cloud or Local LAN. | App sets `Cloud`. | App sets `Local (LAN)`. | App-level, not a Hoymiles field. |
| Gateway Online | Capability | Whether the HiBox/Gateway is online. | S-Miles device list shows Gateway is Online. | Unknown. | Fix current mapping if Homey shows `No` while S-Miles says Online. |
| Last Update | Capability | Timestamp of last successful data update. | App-level timestamp from successful API poll. | App-level timestamp from successful Modbus poll. | Works as app-level value. |

---

## 7. Important sign-convention notes

### Battery power

Your logs show examples like:

```text
bat=1150
Battery Charge Power = 1150 W
Battery Discharge Power = 0 W
```

This implies the app currently interprets positive battery power as charging.

However, one S-Miles battery page showed:

```text
Battery Status: Discharging
Battery Power: 1183 W
```

That creates a possible sign-convention ambiguity.

Recommended action:

```text
Capture a simultaneous API snapshot and S-Miles screenshot during:
1. definite charging
2. definite discharging
3. idle
```

Then confirm whether API `bat` positive means charging or discharging.

### Grid power

Current interpretation appears to be:

```text
grid > 0  => importing
grid < 0  => exporting
grid ≈ 0  => neutral
```

Example:

```text
grid=-5 => Grid Export Power 5 W
```

This is plausible and should be kept, but add a deadband to avoid flickering.

---

## 8. Recommended formulas

### Battery charge/discharge split

```javascript
const POWER_DEADBAND_W = 10;

function splitBatteryPower(batteryPowerW) {
  if (!Number.isFinite(batteryPowerW)) {
    return { chargePowerW: null, dischargePowerW: null, state: 'Unknown' };
  }

  if (batteryPowerW > POWER_DEADBAND_W) {
    return { chargePowerW: batteryPowerW, dischargePowerW: 0, state: 'Charging' };
  }

  if (batteryPowerW < -POWER_DEADBAND_W) {
    return { chargePowerW: 0, dischargePowerW: Math.abs(batteryPowerW), state: 'Discharging' };
  }

  return { chargePowerW: 0, dischargePowerW: 0, state: 'Idle' };
}
```

### Grid import/export split

```javascript
const GRID_DEADBAND_W = 10;

function splitGridPower(gridPowerW) {
  if (!Number.isFinite(gridPowerW)) {
    return { importPowerW: null, exportPowerW: null, state: 'Unknown' };
  }

  if (gridPowerW > GRID_DEADBAND_W) {
    return { importPowerW: gridPowerW, exportPowerW: 0, state: 'Importing' };
  }

  if (gridPowerW < -GRID_DEADBAND_W) {
    return { importPowerW: 0, exportPowerW: Math.abs(gridPowerW), state: 'Exporting' };
  }

  return { importPowerW: 0, exportPowerW: 0, state: 'Neutral' };
}
```

### Self-powered percentage

```javascript
function calculateSelfPoweredPercent(loadPowerW, gridImportPowerW) {
  if (!Number.isFinite(loadPowerW) || loadPowerW <= 0) return null;
  if (!Number.isFinite(gridImportPowerW)) return null;

  const localSupplyW = Math.max(0, loadPowerW - gridImportPowerW);
  return Math.max(0, Math.min(100, (localSupplyW / loadPowerW) * 100));
}
```

### Time to full

```javascript
function calculateTimeToFullHours(socPercent, maxSocPercent, capacityKwh, chargePowerW) {
  if (
    !Number.isFinite(socPercent) ||
    !Number.isFinite(maxSocPercent) ||
    !Number.isFinite(capacityKwh) ||
    !Number.isFinite(chargePowerW) ||
    chargePowerW <= 0
  ) {
    return 0;
  }

  const remainingPercent = Math.max(0, maxSocPercent - socPercent);
  const remainingKwh = capacityKwh * remainingPercent / 100;
  return remainingKwh / (chargePowerW / 1000);
}
```

### Battery runtime

```javascript
function calculateBatteryRuntimeHours(socPercent, reserveSocPercent, capacityKwh, dischargePowerW) {
  if (
    !Number.isFinite(socPercent) ||
    !Number.isFinite(reserveSocPercent) ||
    !Number.isFinite(capacityKwh) ||
    !Number.isFinite(dischargePowerW) ||
    dischargePowerW <= 0
  ) {
    return 0;
  }

  const usablePercent = Math.max(0, socPercent - reserveSocPercent);
  const usableKwh = capacityKwh * usablePercent / 100;
  return usableKwh / (dischargePowerW / 1000);
}
```

---

## 9. S-Miles Cloud correlation

### Dashboard / plant overview

| S-Miles field | Example value | App capability |
|---|---:|---|
| PV Power | `0 W` | PV Power |
| Grid Power | near `0 W` / `-5 W` | Grid Power |
| Load Power | `951 W` / `1.18 kW` | Load Power |
| Battery Power | `1150 W` / `1.18 kW` | Battery Power |
| Energy Today | `47.8 kWh` | Daily Energy |
| Energy This Month | `111.6 kWh` | Monthly Energy |
| Energy This Year | `111.6 kWh` | Yearly Energy |
| Lifetime Energy | `111.6 kWh` | Total Energy / Total Energy Generated |
| Operating Mode | `Self-Consumption Mode` | Mode option |
| Network Status | Normal | System/Gateway diagnostics |
| System Status | Normal | Generic Alarm / System State |
| Battery Capacity | `32 kWh` | Capacity used for calculations |
| CO₂ Emission Reduction | `111.27 kg` | CO2 Reduction |
| Equivalent Trees Planted | `6 Trees` | Optional future environmental capability |

### Historical overview

| S-Miles field | Example value | App mapping |
|---|---:|---|
| Production | `47.8 kWh` | Daily Energy |
| Consumption | `29.5 kWh` | Consumption statistic, if added |
| From Grid | `12.9 kWh` | Grid Import Energy, if added |
| To Grid | `8.9 kWh` | Grid Export Energy, if added |
| Discharge | `3.3 kWh` | Energy Discharged |
| Charge | `25.8 kWh` | Energy Charged |
| SOC curve | about `92%` | Battery SOC |

### Inverter realtime values

These are not all current Homey capabilities, but they are useful candidates for future advanced capabilities:

| S-Miles field | Example value |
|---|---:|
| Combined Active Power | `964 W` |
| Phase A Voltage | `234.2 V` |
| Phase B Voltage | `234.7 V` |
| Phase C Voltage | `235.2 V` |
| Phase A Current | `1.8 A` |
| Phase B Current | `1.85 A` |
| Phase C Current | `1.77 A` |
| Phase A Active Power | `315 W` |
| Phase B Active Power | `329 W` |
| Phase C Active Power | `320 W` |
| Frequency | `50.02 Hz` |
| Internal Ambient Temperature | `37°C` |
| Total Bus Voltage | `771.4 V` |

### Battery realtime values

| S-Miles field | Example value | Possible app mapping |
|---|---:|---|
| Battery SOC | `92%` | Add as explicit SOC capability or use for calculations |
| Battery SOH | `100%` | Optional health capability |
| Battery Status | `Discharging` | Battery State |
| Battery Voltage | `26.4 V` | Optional advanced battery capability |
| Battery Current | `44.5 A` | Optional advanced battery capability |
| Battery Power | `1183 W` | Battery Power |
| Max Charging Current | `248.0 A` | Diagnostic |
| Max Discharging Current | `628.0 A` | Diagnostic |
| Charge Cutoff Voltage | `29.2 V` | Diagnostic |
| Discharge Cutoff Voltage | `22.4 V` | Diagnostic |
| Max Cell Voltage | `3.319 V` | Diagnostic |
| Min Cell Voltage | `3.316 V` | Diagnostic |
| Max Cell Temperature | `30.8°C` | Diagnostic |
| Min Cell Temperature | `26.1°C` | Diagnostic |

### Battery pack table

| Battery SN | Status | Power | Voltage | SOC |
|---|---|---:|---:|---:|
| `23C02621015E` | Discharging | `294 W` | `26.4 V` | `92%` |
| `23C026210191` | Discharging | `298 W` | `26.4 V` | `92%` |
| `23C0262100E3` | Discharging | `299 W` | `26.4 V` | `92%` |
| `23C0262100E2` | Discharging | `286 W` | `26.5 V` | `92%` |

---

## 10. Modbus TCP findings

### Endpoint

```text
Host: 192.168.1.116
Port: 502
Unit ID: 1
```

The device responds to Modbus TCP, so the connection works.

### Quick Scan

Readable areas were found, including:

```text
DTU_INFO: start 0
PV_PORT_0: start 0x1000
PV_PORT_1: start 0x1028
PV_PORT_2: start 0x1050
PV_PORT_3: start 0x1078
```

These ranges resemble older Hoymiles DTU-Pro / microinverter mapping concepts and do not yet correlate with HiOne ESS realtime values.

### Deep Scan

Deep Scan found repeated values such as:

```text
address 62250-62299
value = 9360
hex = 0x2490
```

This repeated value pattern does not look like meaningful live data.

### ESS Probe

```text
No plausible ESS data found in candidate register blocks.
```

This supports the conclusion that the correct HiOne ESS register range has not yet been found.

### Modbus mapping status

| Capability | Current Modbus status |
|---|---|
| PV Power | Not confirmed |
| Battery Power | Not working |
| Grid Power | Not working |
| Load Power | Not working |
| Daily Energy | Not working |
| Total Energy | Invalid |
| Charge/Discharge Power | Not working |
| Grid Import/Export Power | Not working |
| Battery/Grid State | Not reliable |
| System State | Works as local connection state |
| Last Update | Works as app-level timestamp |

---

## 11. Validation recommendations

Add validation before updating Homey capabilities.

```javascript
function validateCapabilityValue(name, value) {
  if (!Number.isFinite(value) && typeof value !== 'string' && typeof value !== 'boolean') {
    return { ok: false, reason: 'invalid type or non-finite value' };
  }

  switch (name) {
    case 'totalEnergy':
    case 'totalEnergyGenerated':
      if (value < 0 || value > 100000) {
        return { ok: false, reason: 'implausible total energy' };
      }
      break;

    case 'dailyEnergy':
      if (value < 0 || value > 200) {
        return { ok: false, reason: 'implausible daily energy' };
      }
      break;

    case 'pvPower':
    case 'batteryPower':
    case 'gridPower':
    case 'loadPower':
      if (value < -50000 || value > 50000) {
        return { ok: false, reason: 'implausible power value' };
      }
      break;

    case 'selfPowered':
      if (value < 0 || value > 100) {
        return { ok: false, reason: 'percentage out of range' };
      }
      break;
  }

  return { ok: true };
}
```

When validation fails:

```text
- Do not update the Homey capability.
- Keep the last valid value.
- Log source, raw value, mapped value and rejection reason.
- If the source is Modbus, fall back to Cloud/API if available.
```

---

## 12. Recommended source mode behaviour

### Cloud mode

```text
Use Cloud/API for all capabilities.
Connection Source = Cloud.
System State = Online (Cloud) when API poll succeeds.
Last Update = successful API poll timestamp.
```

### Local LAN mode

```text
Use Modbus only for confirmed mappings.
Connection Source = Local (LAN).
System State = Online (Local) when Modbus connects.
Do not publish unknown values as zero.
Do not publish invalid total energy.
```

### Hybrid mode

Recommended default:

```text
Use Cloud/API as primary telemetry source.
Use Modbus TCP to show local availability.
Use Modbus telemetry only when mapping confidence is confirmed.
If Modbus data fails validation, keep Cloud/API values.
```

---

## 13. Specific issues to fix

### 13.1 Disable local total energy mapping

Problem:

```text
Cloud/API total = 111.6 kWh
S-Miles total = 111.6 kWh
Modbus total = 613426.32 kWh
```

Action:

```text
Disable or remove the current Modbus total-energy mapping.
Reject implausible total energy values.
Use API `total`.
```

### 13.2 Fix Gateway Online

Problem:

```text
Homey screenshot: Gateway Online = No
S-Miles device list: Gateway 28E026139783 = Online
```

Action:

```text
Map Gateway Online to the S-Miles gateway device status.
Gateway SN: 28E026139783
Model: HiBox-63T-G3
```

### 13.3 Fix Monthly and Yearly Energy

Problem:

```text
S-Miles:
Energy This Month = 111.6 kWh
Energy This Year = 111.6 kWh

Homey screenshot:
Monthly Energy = 0 kWh
Yearly Energy = 0 kWh
```

Action:

```text
Add or fix API statistics mapping.
Do not use Modbus for these values yet.
```

### 13.4 Clarify Energy Charged / Energy Discharged

Problem:

```text
Homey screenshot:
Energy Charged = 3.7 kWh
Energy Discharged = 0 kWh

S-Miles day totals:
Charge = 25.8 kWh
Discharge = 3.3 kWh
```

Action:

```text
Clarify whether Homey should show daily, lifetime, current-cycle or API-specific counters.
Document the period in capability comments.
```

---

## 14. Suggested internal mapping structure

```javascript
const propertyMappings = {
  pvPower: {
    type: 'capability',
    description: 'Current PV production power',
    cloud: {
      field: 'pv',
      unit: 'W',
      confidence: 'confirmed',
    },
    modbus: {
      address: null,
      unit: 'W',
      confidence: 'unknown',
      notes: 'Local mapping not confirmed',
    },
  },

  batteryPower: {
    type: 'capability',
    description: 'Current battery charge/discharge power',
    cloud: {
      field: 'bat',
      unit: 'W',
      confidence: 'confirmed',
    },
    modbus: {
      address: null,
      unit: 'W',
      confidence: 'unknown',
      notes: 'Current local mapping reads zero while Cloud shows non-zero',
    },
  },

  totalEnergy: {
    type: 'capability',
    description: 'Lifetime generated energy',
    cloud: {
      field: 'total',
      unit: 'kWh',
      confidence: 'confirmed',
    },
    modbus: {
      address: null,
      unit: 'kWh',
      confidence: 'invalid',
      notes: 'Previous mapping produced invalid 613426.32 kWh',
    },
  },
};
```

Suggested confidence levels:

```text
confirmed
probable
experimental
unknown
invalid
```

---

## 15. Recommended future child-device model

The S-Miles hierarchy supports a main device plus child devices.

### Main device: HiOne Station / Plant

```text
- PV Power
- Battery Power
- Grid Power
- Load Power
- Daily/Monthly/Yearly/Total Energy
- Operating Mode
- Self-Powered
- Energy Independence
- System State
```

### Inverter child: HiOne-16T-G3

```text
- phase voltages
- phase currents
- phase active power
- frequency
- internal temperature
- bus voltage
- hardware/firmware versions
```

### Gateway child: HiBox-63T-G3

```text
- online status
- hardware/firmware versions
- backup/grid state if available
```

### Battery module children: HiOne-8B-G3

```text
- battery module SOC
- battery module power
- battery module voltage
- battery module status
- BMS firmware
- DCDC firmware
- cell temperatures
- cell voltages
```

---

## 16. Immediate to-do list

### Must do

```text
1. Disable the current Modbus total-energy mapping.
2. Keep Cloud/API as authoritative for production capabilities.
3. Add value validation before updating Homey capabilities.
4. Fix Gateway Online using S-Miles gateway status.
5. Fix Monthly Energy and Yearly Energy from Cloud/API statistics.
6. Document battery and grid power sign conventions.
```

### Should do

```text
1. Add mapping confidence metadata per capability.
2. Add debug logging for raw value, mapped value, source and validation result.
3. Add hybrid mode: Cloud telemetry plus Local LAN availability.
4. Add a Modbus discovery/export tool.
5. Add per-device child devices for inverter, gateway and battery modules.
```

### Could do

```text
1. Add advanced inverter diagnostics.
2. Add advanced battery diagnostics.
3. Add environmental values like trees planted and saved coal.
4. Add tariff-based profit calculation in Homey if S-Miles price is not configured.
```

---

## 17. Final conclusion

The Homey app should currently use the Hoymiles Cloud/API as the reliable data source for capabilities, settings and metadata. The supplied logs and screenshots show that the API values correlate with S-Miles Cloud.

The Modbus TCP connection is reachable on the local LAN, but the current register mapping is not yet suitable for production HiOne telemetry. The incorrect `613426.32 kWh` total energy value proves that at least part of the current Modbus mapping is invalid.

Recommended implementation approach:

```text
Cloud/API = production source
Modbus TCP = experimental diagnostics
Hybrid mode = best default
```

Only promote a Modbus value to production once it has been correlated with a simultaneous Cloud/API or S-Miles snapshot and marked as confirmed.
