# Report: Hoymiles HiOne Modbus TCP Mapping Findings and Homey App Recommendations

## 1. Purpose

This report documents the current findings regarding the Modbus TCP mapping for a Hoymiles HiOne system and explains how the Modbus TCP data relates to the data visible in S-Miles Cloud / Hoymiles API screenshots.

The goal is to support further development of the Homey app for the Hoymiles HiOne system, especially the local LAN / Modbus TCP integration.

---

## 2. System Context

The system under analysis is a Hoymiles HiOne home battery / energy storage setup.

Based on the S-Miles / Hoymiles screenshots, the device hierarchy appears to be:

```text
DTU / Communication device
SN: 430526031404
│
└── Inverter
    SN: 228326070238
    Type: HiOne-16T-G3
    │
    ├── Gateway
    │   SN: 28E026139783
    │
    ├── Battery module
    │   SN: 23C02621015E
    │
    ├── Battery module
    │   SN: 23C026210191
    │
    ├── Battery module
    │   SN: 23C0262100E3
    │
    └── Battery module
        SN: 23C0262100E2
```

### Identified Components

| Component | Type in S-Miles | Serial Number |
|---|---|---:|
| DTU / Communication device | DTU | `430526031404` |
| Inverter | Inverter / HiOne-16T-G3 | `228326070238` |
| Gateway | Gateway | `28E026139783` |
| Battery module 1 | Battery | `23C02621015E` |
| Battery module 2 | Battery | `23C026210191` |
| Battery module 3 | Battery | `23C0262100E3` |
| Battery module 4 | Battery | `23C0262100E2` |

---

## 3. Cloud/API Data Versus Local Modbus TCP Data

Two data sources are currently available in the Homey app:

1. Hoymiles Cloud / S-Miles API
2. Local LAN connection via Modbus TCP

The screenshots show that the cloud/API data looks realistic and consistent with the Hoymiles portal, while the Modbus TCP data is currently incomplete or incorrectly mapped.

### Example: Cloud/API Data

The first Homey screenshot, using the Hoymiles API, shows realistic values:

```text
PV Power: 0 W
Battery Power: 2 W
Grid Power: -59 W
Load Power: 669 W
Daily Energy: 1.2 kWh
Total Energy Generated: 111.6 kWh
Total Energy: 111.6 kWh
Battery Charge Power: 2 W
Battery Discharge Power: 0 W
Grid Import Power: 0 W
Grid Export Power: 59 W
Battery State: Idle
Grid State: Exporting
Generic Alarm: No
Self-Powered: 100 %
Battery Runtime: 0 h
Time to Full: 1775 h
Power Balance: -726 W
Energy Independence: Exporting Surplus
System State: Online (Cloud)
Connection Source: Cloud
```

These values are also broadly consistent with the S-Miles portal screenshots.

### Example: Modbus TCP Data

The second Homey screenshot, using Modbus TCP, shows:

```text
PV Power: 0 W
Battery Power: 0 W
Grid Power: 0 W
Load Power: 0 W
Daily Energy: 0 kWh
Total Energy Generated: 613426.32 kWh
Total Energy: 613426.32 kWh
Battery Charge Power: 0 W
Battery Discharge Power: 0 W
Grid Import Power: 0 W
Grid Export Power: 0 W
Battery State: Idle
Grid State: Neutral
Generic Alarm: No
Self-Powered: 100 %
Battery Runtime: 0 h
Time to Full: 0 h
Power Balance: 0 W
Energy Independence: Self-Sufficient
System State: Online (Local)
Connection Source: Local LAN
```

The value `613426.32 kWh` is clearly invalid when compared with the cloud/API and S-Miles value of approximately `111.6 kWh`.

This strongly indicates that the current Modbus TCP register mapping is wrong for at least the energy counters, and probably also incomplete for realtime power values.

---

## 4. Important Finding: The Current `0x2000` Area Is Not Plant Energy

The Modbus TCP dump contained this block:

```json
"PLANT_AGG": {
  "label": "Plant aggregate",
  "start": 8192,
  "regs": [
    {
      "offset": 4,
      "addr": 8196,
      "hex": "0x2004",
      "value": 9360
    },
    {
      "offset": 5,
      "addr": 8197,
      "hex": "0x2005",
      "value": 9360
    },
    {
      "offset": 6,
      "addr": 8198,
      "hex": "0x2006",
      "value": 9360
    },
    {
      "offset": 7,
      "addr": 8199,
      "hex": "0x2007",
      "value": 9360
    },
    {
      "offset": 8,
      "addr": 8200,
      "hex": "0x2008",
      "value": 13106
    },
    {
      "offset": 9,
      "addr": 8201,
      "hex": "0x2009",
      "value": 12355
    },
    {
      "offset": 10,
      "addr": 8202,
      "hex": "0x200a",
      "value": 13874
    },
    {
      "offset": 11,
      "addr": 8203,
      "hex": "0x200b",
      "value": 12594
    },
    {
      "offset": 12,
      "addr": 8204,
      "hex": "0x200c",
      "value": 12336
    },
    {
      "offset": 13,
      "addr": 8205,
      "hex": "0x200d",
      "value": 13125
    }
  ]
}
```

The current Homey app appears to interpret part of this area as an energy counter.

However, this area contains identity/device information, not plant energy.

---

## 5. Explanation of the Incorrect `613426.32 kWh` Value

The Modbus TCP screenshot shows:

```text
Total Energy Generated: 613426.32 kWh
Total Energy: 613426.32 kWh
```

This value can be explained directly from the incorrect interpretation of registers `0x2004` and `0x2005`.

Both registers contain:

```text
0x2004 = 9360 decimal = 0x2490
0x2005 = 9360 decimal = 0x2490
```

If these two 16-bit registers are combined as a 32-bit value:

```text
0x2490 0x2490 = 0x24902490
```

Decimal:

```text
0x24902490 = 613426320
```

If the app then applies a scale factor of `0.001`, this becomes:

```text
613426320 / 1000 = 613426.32
```

That exactly matches the incorrect Homey value:

```text
613426.32 kWh
```

### Conclusion

The value `613426.32 kWh` is not a real energy value.

It is caused by treating registers `0x2004` and `0x2005` as a numeric 32-bit energy counter, while they are most likely part of an identity/header/unknown block.

Therefore:

```text
Do not use 0x2004 / 0x2005 as Total Energy.
Do not use the current 0x2000 mapping as Plant Aggregate energy data.
```

---

## 6. Confirmed Mapping: Battery Serial Number at `0x2008` - `0x200D`

The strongest confirmed mapping from the current Modbus dump is that registers `0x2008` through `0x200D` decode to one of the battery serial numbers visible in S-Miles.

### Raw Register Values

| Address | Hex Address | Decimal Value | Hex Value |
|---:|---:|---:|---:|
| `8200` | `0x2008` | `13106` | `0x3332` |
| `8201` | `0x2009` | `12355` | `0x3043` |
| `8202` | `0x200A` | `13874` | `0x3632` |
| `8203` | `0x200B` | `12594` | `0x3132` |
| `8204` | `0x200C` | `12336` | `0x3030` |
| `8205` | `0x200D` | `13125` | `0x3345` |

When decoded as ASCII with low-byte-first ordering per 16-bit register:

```text
0x3332 -> "23"
0x3043 -> "C0"
0x3632 -> "26"
0x3132 -> "21"
0x3030 -> "00"
0x3345 -> "E3"
```

Combined:

```text
23C0262100E3
```

This matches one of the battery module serial numbers in S-Miles:

```text
Battery SN: 23C0262100E3
```

### Confirmed Mapping

| Modbus Address Range | Meaning | Decoding |
|---|---|---|
| `0x2008` - `0x200D` | Battery module serial number | ASCII, low-byte-first per 16-bit word |
| Decoded value | `23C0262100E3` | Matches S-Miles battery module |

This means the `0x2000` area contains at least one device serial number and should be treated as an identity/device information area unless proven otherwise.

---

## 7. S-Miles Basic Information Available Per Device

The screenshots show that S-Miles Cloud has rich device metadata.

### DTU

```text
Type: DTU
SN: 430526031404
Hardware Ver.: H11.02.01
Firmware Ver.: V03.00.13
Communication Module Version: -
Creation Time: 2026-06-12 21:38:46 UTC+01
Replacement Record: 0
Alarm Status: Normal
Plant: Coemans
```

### Inverter

```text
Type: Inverter
SN: 228326070238
Hardware Ver.: H1.01.00
Firmware Ver. System: V00.01.35
Firmware Ver. Power: V01.00.32
Firmware Ver. Safety: V01.00.13
Firmware Ver. Display: V00.00.20
Creation Time: 2026-06-12 22:14:45 UTC+01
Replacement Record: 0
Plant: Coemans
```

### Gateway

```text
Type: Gateway
SN: 28E026139783
Hardware Ver.: V00.00.00
Firmware Ver.: V00.01.08
Creation Time: -
Plant: Coemans
```

### Battery

```text
Type: Battery
SN: 23C02621015E
Hardware Ver.: H00.00.00
Firmware Ver. BMS: V01.00.01.18
Firmware Ver. DCDC: V00.01.06
Plant: Coemans
```

At this stage, these firmware and hardware versions have not yet been found in the current Modbus TCP dump.

Recommendation:

```text
Use the cloud/API as the primary source for device hierarchy, serial numbers, firmware versions and hardware versions.
Use Modbus TCP only for values that have been confidently mapped.
```

---

## 8. Realtime Values Visible in S-Miles

The S-Miles realtime screen shows values that should eventually be mapped via Modbus TCP.

### Energy Storage Inverter Values

```text
Master/Slave: Single
Working Status: On-grid Mode

Phase A Voltage: 235.2 V
Phase B Voltage: 233.5 V
Phase C Voltage: 235.7 V

Phase A Current: 1.19 A
Phase B Current: 1.16 A
Phase C Current: 1.09 A

Combined Active Power: -166 W
Phase A Active Power: -66 W
Phase B Active Power: -45 W
Phase C Active Power: -55 W

Frequency: 49.98 Hz

Phase A Reactive Power: 272 Var
Phase B Reactive Power: 259 Var
Phase C Reactive Power: 244 Var

EPS Phase-A Voltage: 235.9 V
EPS Phase-B Voltage: 232.7 V
EPS Phase-C Voltage: 235.8 V

DRM Mode: 1
Internal Ambient Temperature: 30 °C
Total Bus Voltage: 753.4 V
```

### Battery Values

```text
Battery Type: Li-ion
Battery SOC: 29 %
Battery SOH: 100 %
Battery Status: Standby
Fault Code: 0

Battery Voltage: 26.1 V
Battery Current: -0.1 A
Battery Power: 3 W

Max. Charging Current: 520.0 A
Max. Discharging Current: 628.0 A

Charge Cutoff Voltage: 29.2 V
Discharge Cutoff Voltage: 22.4 V

Max. Cell Voltage: 3.288 V
Min. Cell Voltage: 3.276 V

Max. Cell Temperature: 22 °C
Min. Cell Temperature: 18.7 °C

Max. Module Temperature: -
Min. Module Temperature: -
Max. Module Voltage: -
Min. Module Voltage: -
```

These values were not clearly present in the Modbus dump that was scanned.

Expected raw values would likely look like this if the scale factors are typical:

| S-Miles Value | Possible Raw Register Value |
|---|---:|
| `235.2 V` | `2352` if scale is `0.1` |
| `233.5 V` | `2335` if scale is `0.1` |
| `235.7 V` | `2357` if scale is `0.1` |
| `49.98 Hz` | `4998` if scale is `0.01` |
| `29 %` SOC | `29` or `290` |
| `26.1 V` battery voltage | `261` if scale is `0.1` |
| `753.4 V` bus voltage | `7534` if scale is `0.1` |
| `-166 W` | signed `-166`, or unsigned `65370` if signed conversion is missing |
| `-59 W` | signed `-59`, or unsigned `65477` if signed conversion is missing |
| `669 W` | `669` |
| `111.6 kWh` | `1116`, `11160`, `111600`, depending on scale |

The current Modbus ranges scanned did not contain these expected patterns.

---

## 9. Why the Current Modbus Map Is Probably Based on the Wrong Device Family

The current scan uses ranges such as:

```text
0x1000
0x1028
0x1050
0x1078
0x2000
```

These ranges resemble the Modbus map used for Hoymiles DTU-Pro / microinverter systems, where each microinverter or PV port has a repeated register block.

However, the HiOne system is not a normal microinverter-only system. It is a hybrid storage system consisting of:

```text
Inverter
Battery modules
Gateway
DTU / communication module
EMS / storage control
```

Therefore, it is risky to assume that the older DTU-Pro microinverter register map applies to the HiOne-16T-G3 system.

### Current Evidence

- The app reads `0x2004` / `0x2005` as total energy.
- Those registers generate the invalid value `613426.32 kWh`.
- The nearby registers `0x2008` - `0x200D` decode to a battery serial number.
- Therefore, this address area is not a plant energy block.
- The realtime S-Miles values are not visible in the scanned ranges.

Conclusion:

```text
The current Modbus TCP register map is not the correct HiOne realtime register map.
```

---

## 10. Recommended Homey App Architecture

The Homey app should clearly separate the two data sources:

```text
Cloud/API mode
Local Modbus TCP mode
Hybrid mode
```

### 10.1 Cloud/API Mode

Use cloud/API mode for:

```text
Device hierarchy
Plant information
DTU serial number
Inverter serial number
Gateway serial number
Battery module serial numbers
Firmware versions
Hardware versions
Realtime dashboard values
Energy totals
Status values
Alarm status
```

This is currently the most complete and reliable source.

### 10.2 Local Modbus TCP Mode

Use Modbus TCP mode only for values that have been validated against S-Miles.

At this stage, confirmed local Modbus values are very limited.

Known confirmed value:

```text
0x2008 - 0x200D = Battery serial number 23C0262100E3
```

Do not expose a value via Homey unless:

1. The register is known.
2. The data type is known.
3. The byte order is known.
4. The scale factor is known.
5. The value has been compared against S-Miles / cloud/API at the same point in time.

### 10.3 Hybrid Mode

Hybrid mode is recommended.

Suggested source priority:

| Data Type | Preferred Source |
|---|---|
| Device hierarchy | Cloud/API |
| Serial numbers | Cloud/API, Modbus only if confirmed |
| Firmware versions | Cloud/API |
| Hardware versions | Cloud/API |
| Realtime power values | Cloud/API until Modbus is mapped |
| Energy totals | Cloud/API until Modbus is mapped |
| Battery SOC/SOH | Cloud/API until Modbus is mapped |
| Local availability status | Modbus TCP connection |
| Experimental local values | Modbus TCP, hidden behind debug/experimental flag |

---

## 11. Recommended Capability Validation Rules

To prevent wrong values from being shown in Homey, add validation logic.

### 11.1 Energy Counter Validation

Reject total energy values when:

```text
value < 0
value > plausible maximum
value differs too much from cloud/API value
value is generated from an identity/string register block
```

Suggested initial rule:

```javascript
function isPlausibleTotalEnergyKwh(value) {
  return Number.isFinite(value) && value >= 0 && value < 100000;
}
```

For a newly installed residential battery system, a value like `613426.32 kWh` should be treated as invalid.

### 11.2 Power Value Validation

Suggested plausibility checks:

```javascript
function isPlausiblePowerW(value) {
  return Number.isFinite(value) && value > -50000 && value < 50000;
}
```

### 11.3 Voltage Validation

Suggested checks:

```javascript
function isPlausiblePhaseVoltageV(value) {
  return Number.isFinite(value) && value >= 180 && value <= 260;
}

function isPlausibleBatteryVoltageV(value) {
  return Number.isFinite(value) && value > 0 && value < 1000;
}
```

### 11.4 Battery SOC Validation

```javascript
function isPlausibleSoc(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}
```

### 11.5 Invalid Value Handling

Do not publish invalid values to Homey capabilities.

Recommended behavior:

```text
If value is invalid:
- log warning
- keep previous valid value if available
- mark capability as stale if needed
- do not overwrite a good value with an obviously wrong value
```

---

## 12. Recommended Data Model

Use a clear device identity model.

```javascript
const deviceIdentity = {
  source: 'cloud', // cloud | modbus | manual
  type: 'inverter', // dtu | inverter | gateway | battery | meter | unknown
  serialNumber: null,
  model: null,
  hardwareVersion: null,
  firmwareVersions: {
    main: null,
    system: null,
    power: null,
    safety: null,
    display: null,
    bms: null,
    dcdc: null,
    communicationModule: null,
  },
  parentSerialNumber: null,
};
```

For realtime measurements:

```javascript
const realtimeData = {
  source: 'cloud', // cloud | modbus
  timestamp: null,

  pvPowerW: null,
  batteryPowerW: null,
  gridPowerW: null,
  loadPowerW: null,

  dailyEnergyKwh: null,
  totalEnergyKwh: null,

  batteryChargePowerW: null,
  batteryDischargePowerW: null,
  gridImportPowerW: null,
  gridExportPowerW: null,

  batterySocPercent: null,
  batterySohPercent: null,
  batteryVoltageV: null,
  batteryCurrentA: null,

  phaseAVoltageV: null,
  phaseBVoltageV: null,
  phaseCVoltageV: null,

  phaseACurrentA: null,
  phaseBCurrentA: null,
  phaseCCurrentA: null,

  phaseAActivePowerW: null,
  phaseBActivePowerW: null,
  phaseCActivePowerW: null,

  frequencyHz: null,
  internalTemperatureC: null,
  totalBusVoltageV: null,

  batteryState: null,
  gridState: null,
  alarm: null,
};
```

---

## 13. Recommended Register Scanner Strategy

Because the correct HiOne Modbus map is not yet known, implement or use a scanner that reads broad ranges and compares values against known S-Miles/cloud values.

### 13.1 Scan Candidate Ranges

Recommended ranges to scan:

```text
0x0000 - 0x00FF
0x0100 - 0x01FF
0x1000 - 0x10FF
0x1100 - 0x11FF
0x2000 - 0x20FF
0x2100 - 0x21FF
0x2200 - 0x22FF
0x3000 - 0x30FF
0x4000 - 0x40FF
```

Use safe block sizes, for example:

```text
Read 20 to 50 registers per request.
If connection resets, reduce block size.
Add delay between requests.
```

### 13.2 Search for Known Live Values

At the time of scanning, record the S-Miles/cloud values.

Example target values:

```text
Phase A Voltage: 235.2 V
Phase B Voltage: 233.5 V
Phase C Voltage: 235.7 V
Frequency: 49.98 Hz
Battery SOC: 29 %
Battery Voltage: 26.1 V
Battery Power: 3 W
Grid Power: -59 W
Load Power: 669 W
Total Energy: 111.6 kWh
```

Search Modbus registers for raw patterns:

```text
2352
2335
2357
4998
29
290
261
3
30
-59
65477
669
1116
11160
111600
```

### 13.3 Test Signed Conversion

Many power values can be negative.

For a 16-bit register:

```javascript
function toSigned16(value) {
  return value > 0x7FFF ? value - 0x10000 : value;
}
```

Example:

```text
65477 unsigned = -59 signed
65370 unsigned = -166 signed
```

### 13.4 Test 32-bit Byte Orders

Energy counters may use 32-bit values.

Test all common word/byte orders:

```text
ABCD
BADC
CDAB
DCBA
```

Example helper:

```javascript
function combineU32(registerA, registerB, order = 'ABCD') {
  const aHi = (registerA >> 8) & 0xff;
  const aLo = registerA & 0xff;
  const bHi = (registerB >> 8) & 0xff;
  const bLo = registerB & 0xff;

  let bytes;

  switch (order) {
    case 'ABCD':
      bytes = [aHi, aLo, bHi, bLo];
      break;
    case 'BADC':
      bytes = [aLo, aHi, bLo, bHi];
      break;
    case 'CDAB':
      bytes = [bHi, bLo, aHi, aLo];
      break;
    case 'DCBA':
      bytes = [bLo, bHi, aLo, aHi];
      break;
    default:
      throw new Error(`Unsupported byte order: ${order}`);
  }

  return (
    (bytes[0] << 24) |
    (bytes[1] << 16) |
    (bytes[2] << 8) |
    bytes[3]
  ) >>> 0;
}
```

Test scale factors:

```text
1
0.1
0.01
0.001
0.0001
```

### 13.5 Decode ASCII Regions

Identity registers can contain text.

Use both high-byte-first and low-byte-first decoding.

```javascript
function decodeAsciiFromRegisters(registers, byteOrder = 'low-high') {
  const chars = [];

  for (const reg of registers) {
    const high = (reg >> 8) & 0xff;
    const low = reg & 0xff;

    if (byteOrder === 'high-low') {
      chars.push(high, low);
    } else {
      chars.push(low, high);
    }
  }

  return chars
    .filter(byte => byte >= 32 && byte <= 126)
    .map(byte => String.fromCharCode(byte))
    .join('');
}
```

For the confirmed battery serial number:

```javascript
const registers = [13106, 12355, 13874, 12594, 12336, 13125];

console.log(decodeAsciiFromRegisters(registers, 'low-high'));
// 23C0262100E3
```

---

## 14. Recommended Homey App Changes

### 14.1 Remove or Disable the Current Total Energy Modbus Mapping

The current local Modbus value:

```text
613426.32 kWh
```

is invalid.

Action:

```text
Remove, disable, or mark experimental the current Modbus total energy mapping.
Do not read 0x2004 / 0x2005 as total energy.
```

### 14.2 Add Mapping Confidence Levels

Each local Modbus mapping should have a confidence status.

Example:

```javascript
const modbusMappings = {
  batterySerialNumber: {
    address: 0x2008,
    length: 6,
    type: 'ascii',
    byteOrder: 'low-high',
    confidence: 'confirmed',
    notes: 'Decodes to 23C0262100E3, matching S-Miles battery module SN',
  },

  totalEnergyKwh: {
    address: null,
    type: null,
    confidence: 'unknown',
    notes: 'Current 0x2004/0x2005 mapping is invalid and must not be used',
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

### 14.3 Add Debug Logging

For every Modbus value, log:

```text
raw address
raw register values
hex values
interpreted value
scale factor
byte order
signed/unsigned handling
capability name
validation result
```

Example log:

```text
[Modbus] totalEnergyKwh candidate:
address=0x2004
regs=[9360,9360]
hex=[0x2490,0x2490]
u32_ABCD=613426320
scale=0.001
value=613426.32
validation=FAILED
reason=Conflicts with cloud value 111.6 kWh and register area contains serial number data
```

### 14.4 Add Cloud/Modbus Comparison Mode

Add an internal debug mode that compares cloud/API values with Modbus candidate values.

Example:

```javascript
const comparison = {
  capability: 'totalEnergyKwh',
  cloudValue: 111.6,
  modbusValue: 613426.32,
  delta: 613314.72,
  status: 'reject_modbus',
};
```

### 14.5 Avoid Publishing Experimental Modbus Values

Only publish values to Homey capabilities if:

```text
mapping confidence is confirmed or probable
value passes plausibility validation
value does not conflict heavily with cloud/API baseline
```

For experimental values, log them but do not update the Homey UI.

---

## 15. Recommended Source Priority in the App

Use the following priority model.

### Identity and Metadata

| Value | Preferred Source |
|---|---|
| DTU serial number | Cloud/API |
| Inverter serial number | Cloud/API |
| Gateway serial number | Cloud/API |
| Battery serial numbers | Cloud/API |
| Firmware versions | Cloud/API |
| Hardware versions | Cloud/API |
| Device hierarchy | Cloud/API |

### Realtime Operational Data

| Value | Preferred Source Today | Future Source |
|---|---|---|
| PV Power | Cloud/API | Modbus after confirmed mapping |
| Battery Power | Cloud/API | Modbus after confirmed mapping |
| Grid Power | Cloud/API | Modbus after confirmed mapping |
| Load Power | Cloud/API | Modbus after confirmed mapping |
| Battery SOC | Cloud/API | Modbus after confirmed mapping |
| Battery SOH | Cloud/API | Modbus after confirmed mapping |
| Battery Voltage | Cloud/API | Modbus after confirmed mapping |
| Battery Current | Cloud/API | Modbus after confirmed mapping |
| Phase Voltages | Cloud/API | Modbus after confirmed mapping |
| Frequency | Cloud/API | Modbus after confirmed mapping |

### Energy Counters

| Value | Preferred Source Today | Notes |
|---|---|---|
| Daily Energy | Cloud/API | Current Modbus mapping unknown |
| Total Energy | Cloud/API | Current Modbus mapping is wrong |
| Grid Import Energy | Cloud/API | Current Modbus mapping unknown |
| Grid Export Energy | Cloud/API | Current Modbus mapping unknown |

---

## 16. Suggested Homey App UI Behaviour

### Cloud Mode

Show:

```text
Connection Source: Cloud
System State: Online (Cloud)
```

Use all API values normally.

### Local Modbus Mode

Show:

```text
Connection Source: Local LAN
System State: Online (Local)
```

But only show values where the mapping is confirmed.

For unknown or invalid values:

```text
Do not show wrong values.
Show "-" or "Unknown".
Optionally add a diagnostic message.
```

### Hybrid Mode

Recommended default:

```text
Use cloud/API for all known values.
Use local Modbus only for confirmed local values.
Use local Modbus connection state to show LAN availability.
```

---

## 17. Open Questions

The following items still require investigation:

1. What is the official HiOne Modbus TCP register map?
2. Does the HiOne-16T-G3 expose all realtime values via Modbus TCP?
3. Are battery module values exposed directly, or only aggregated?
4. Are firmware/hardware versions exposed via Modbus TCP, or only via cloud/API?
5. Which device is the actual Modbus TCP server: inverter, HiBox/gateway, DTU, or communication module?
6. Are there separate unit IDs / slave IDs for inverter, gateway, and battery modules?
7. Is the current Modbus map using zero-based or one-based register addressing?
8. Are holding registers or input registers being used for the needed values?
9. Are some values available only via RS485 Modbus RTU and not via TCP?

---

## 18. Recommended Next Technical Steps

### Step 1: Keep Cloud/API as the Reliable Baseline

Use cloud/API data as the truth source while Modbus is still being mapped.

### Step 2: Disable Wrong Local Energy Mapping

Remove the mapping that creates:

```text
613426.32 kWh
```

This value comes from interpreting `0x2004` / `0x2005` incorrectly.

### Step 3: Add a Modbus Discovery Tool

Add a developer/debug function to scan ranges and export raw data.

Recommended output format:

```json
{
  "timestamp": "2026-06-16T08:30:00+02:00",
  "range": "0x2000-0x20FF",
  "registers": [
    {
      "addr": 8192,
      "hex": "0x2000",
      "value": 0,
      "valueHex": "0x0000",
      "signed16": 0,
      "asciiHighLow": "",
      "asciiLowHigh": ""
    }
  ]
}
```

### Step 4: Compare Scan with Known S-Miles Snapshot

At the exact time of the scan, save a snapshot from S-Miles/cloud/API:

```json
{
  "phaseAVoltage": 235.2,
  "phaseBVoltage": 233.5,
  "phaseCVoltage": 235.7,
  "frequency": 49.98,
  "batterySoc": 29,
  "batteryVoltage": 26.1,
  "batteryPower": 3,
  "gridPower": -59,
  "loadPower": 669,
  "totalEnergy": 111.6
}
```

Then search the Modbus dump for likely scaled equivalents.

### Step 5: Identify Serial Number Blocks

Search the full Modbus map for these ASCII strings:

```text
430526031404
228326070238
28E026139783
23C02621015E
23C026210191
23C0262100E3
23C0262100E2
```

Finding these will reveal the structure of the identity/device information area.

### Step 6: Ask Hoymiles or Installer for the HiOne Register Map

Ask specifically for:

```text
Hoymiles HiOne-16T-G3 Modbus TCP register map
HiOne-16T-G3 Modbus protocol document
HiOne energy storage Modbus register list
HiBox-63T-G3 Modbus TCP register map
HiOne battery BMS Modbus register map
```

Make clear that generic DTU-Pro microinverter documentation is not sufficient.

---

## 19. Key Conclusions

1. The local Modbus TCP connection appears to work technically.
2. The current Modbus register mapping does not correctly represent the HiOne realtime/energy data.
3. The local value `613426.32 kWh` is invalid.
4. The invalid value can be traced to interpreting registers `0x2004` and `0x2005` as a 32-bit energy counter.
5. Registers `0x2008` - `0x200D` decode to battery serial number `23C0262100E3`.
6. Therefore, the current `0x2000` block contains identity/device information, not plant aggregate energy.
7. The cloud/API currently provides the most complete and reliable data.
8. Modbus TCP should be treated as experimental until the correct HiOne register map is found.
9. The Homey app should prevent invalid Modbus values from being published to capabilities.
10. A proper Modbus discovery and validation workflow is needed.

---

## 20. Immediate To-Do List for the Homey App

### Must Do

```text
- Disable the current Modbus total energy mapping.
- Mark Modbus TCP support as experimental.
- Add plausibility validation before updating Homey capabilities.
- Keep cloud/API as the default source for dashboard values.
- Add debug logging for raw Modbus registers and interpreted values.
```

### Should Do

```text
- Add source priority: cloud first, confirmed Modbus second.
- Add mapping confidence metadata.
- Add a Modbus scan/export tool.
- Add cloud-versus-Modbus comparison logging.
- Decode ASCII identity blocks from Modbus.
```

### Could Do

```text
- Add a developer setting to show experimental Modbus values.
- Add diagnostics page showing raw register values.
- Add automatic detection of invalid mappings.
- Add fallback from Modbus to cloud when values fail validation.
```

---

## 21. Suggested Developer Note for the Codebase

```text
IMPORTANT:
The current HiOne Modbus TCP mapping is not confirmed.

Do not use the older DTU-Pro / microinverter Modbus register map as-is for HiOne.
The 0x2000 block appears to contain device identity data.
Registers 0x2008-0x200D decode to battery serial number 23C0262100E3.
Registers 0x2004-0x2005 must not be interpreted as total energy, because this creates the invalid value 613426.32 kWh.

Until a confirmed HiOne register map is available, use cloud/API data for production Homey capabilities and treat Modbus values as experimental.
```
