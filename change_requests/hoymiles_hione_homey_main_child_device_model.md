# Hoymiles HiOne Homey App: Main Device and Child Device Model

## 1. Purpose

This document explains whether and how the proposed S-Miles-style hierarchy can be implemented in Homey as a main device with related child devices.

Proposed hierarchy:

```text
HiOne Plant / Station
├── Inverter child device
├── Gateway child device
└── Battery module child devices
```

## 2. Short Answer

Yes, this is possible in Homey, but with one important nuance:

> Homey does not show devices as a real expandable parent-child tree like S-Miles Cloud.

In Homey, every paired item is a normal Homey device. The app can still model parent/child relations internally by storing relation data such as `plantId`, `parentId`, `rootId`, `type`, `serial number`, and `model`.

From the user perspective, the devices will appear as separate related devices, preferably in the same Zone.

Example:

```text
Energy
├── Coemans Station
├── Coemans Inverter - HiOne-16T-G3
├── Coemans Gateway - HiBox-63T-G3
├── Coemans Battery 1 - 23C02621015E
├── Coemans Battery 2 - 23C026210191
├── Coemans Battery 3 - 23C0262100E3
└── Coemans Battery 4 - 23C0262100E2
```

## 3. Homey Conceptual Model

Homey works with apps, drivers, and devices:

```text
Homey App
└── Driver
    └── Device instances
```

A Driver manages paired Device instances. Each Device can have its own:

```text
- data
- settings
- capabilities
- lifecycle methods
```

The key design point is that every created Homey device can store a stable `data` object. This can be used to store the relation to the plant and parent device.

## 4. Recommended Internal Hierarchy

Use the S-Miles Cloud hierarchy as the source of truth:

```text
Plant / Station
plantId: 14076570
│
├── DTU / DTS
│   sn: 430526031404
│
└── Inverter
    sn: 228326070238
    model: HiOne-16T-G3
    │
    ├── Gateway
    │   sn: 28E026139783
    │   model: HiBox-63T-G3
    │
    ├── Battery
    │   sn: 23C02621015E
    │   model: HiOne-8B-G3
    ├── Battery
    │   sn: 23C026210191
    │   model: HiOne-8B-G3
    ├── Battery
    │   sn: 23C0262100E3
    │   model: HiOne-8B-G3
    └── Battery
        sn: 23C0262100E2
        model: HiOne-8B-G3
```

## 5. Recommended Homey Devices

### 5.1 Main Station Device

Suggested name:

```text
Coemans Station
```

Purpose:

```text
- Plant-level power flow
- Operating mode
- Total/daily/monthly/yearly energy
- Grid import/export
- Load power
- PV power
- Battery aggregate
```

Recommended capabilities:

```text
PV Power
Battery Power
Grid Power
Load Power
Daily Energy
Monthly Energy
Yearly Energy
Total Energy
Battery Charge Power
Battery Discharge Power
Grid Import Power
Grid Export Power
Battery State
Grid State
Self-Powered
Power Balance
Energy Independence
System State
Connection Source
Last Update
```

Recommended controls/settings:

```text
Reserve SoC
Max SoC
Max Power
Grid Power Limit

Self-Consumption
Economy
Backup
Off-Grid
Self-Consumption + Max Power
Backup + Max Power
Peak Shaving
Time of Use
```

This should be the main user-facing device.

---

### 5.2 Inverter Child Device

Suggested name:

```text
Coemans Inverter - HiOne-16T-G3
```

Purpose:

```text
- Phase voltages
- Phase currents
- Phase active power
- Frequency
- Internal temperature
- Bus voltage
- Inverter firmware/hardware
```

Recommended capabilities:

```text
Phase A Voltage
Phase B Voltage
Phase C Voltage
Phase A Current
Phase B Current
Phase C Current
Phase A Active Power
Phase B Active Power
Phase C Active Power
Frequency
Internal Ambient Temperature
Total Bus Voltage
Inverter Status
```

Recommended metadata/settings:

```text
SN: 228326070238
Model: HiOne-16T-G3
Hardware Ver.: H1.01.00
Firmware System: V00.01.35
Firmware Power: V01.00.32
Firmware Safety: V01.00.13
Firmware Display: V00.00.20
```

---

### 5.3 Gateway Child Device

Suggested name:

```text
Coemans Gateway - HiBox-63T-G3
```

Purpose:

```text
- Gateway online status
- Gateway firmware/hardware
- Backup/grid-switching status if available
```

Recommended capabilities:

```text
Gateway Online
System State
Generic Alarm
Backup State, if available
Grid State, if gateway-specific
```

Recommended metadata/settings:

```text
SN: 28E026139783
Model: HiBox-63T-G3
Hardware Ver.: V00.00.00
Firmware Ver.: V00.01.08
```

---

### 5.4 Battery Module Child Devices

Suggested names:

```text
Coemans Battery 1 - 23C02621015E
Coemans Battery 2 - 23C026210191
Coemans Battery 3 - 23C0262100E3
Coemans Battery 4 - 23C0262100E2
```

Purpose:

```text
- Module SOC
- Module power
- Module voltage
- Module status
- Max/min cell voltage
- Max/min cell temperature
- BMS firmware
- DCDC firmware
```

Recommended capabilities per battery module:

```text
Battery SOC
Battery SOH
Battery Power
Battery Voltage
Battery Current
Battery State
Max Cell Voltage
Min Cell Voltage
Max Cell Temperature
Min Cell Temperature
Fault Code
```

Recommended metadata/settings:

```text
Model: HiOne-8B-G3
Hardware Ver.: H00.00.00
Firmware Ver. BMS: V01.00.01.18
Firmware Ver. DCDC: V00.01.06
```

## 6. What This Looks Like in Homey

Homey will not show this as a nested device tree:

```text
Station
└── Inverter
    ├── Gateway
    └── Batteries
```

Instead, Homey will show separate devices:

```text
Coemans Station
Coemans Inverter - HiOne-16T-G3
Coemans Gateway - HiBox-63T-G3
Coemans Battery 1 - 23C02621015E
Coemans Battery 2 - 23C026210191
Coemans Battery 3 - 23C0262100E3
Coemans Battery 4 - 23C0262100E2
```

To make the relationship clear:

```text
- Use consistent naming.
- Put all devices in the same Homey Zone.
- Store the plantId and parentId internally.
- Optionally expose parent/child information in diagnostics.
```

## 7. Recommended Pairing Flow

During pairing:

```text
1. User logs in with Hoymiles credentials.
2. App fetches plant/device hierarchy from S-Miles Cloud.
3. App builds a list of Homey devices to create.
4. User selects which devices to add.
5. Homey creates separate devices.
6. Each device stores its own data object with plantId, type, serial number and parentId.
```

Example pairing result:

```text
Coemans Station
Coemans Inverter - HiOne-16T-G3
Coemans Gateway - HiBox-63T-G3
Coemans Battery 1 - HiOne-8B-G3
Coemans Battery 2 - HiOne-8B-G3
Coemans Battery 3 - HiOne-8B-G3
Coemans Battery 4 - HiOne-8B-G3
```

## 8. Recommended Internal `data` Model

### Station device

```javascript
{
  id: '14076570:station',
  plantId: '14076570',
  type: 'station',
  sn: '14076570'
}
```

### Inverter device

```javascript
{
  id: '14076570:inverter:228326070238',
  plantId: '14076570',
  parentId: '14076570:station',
  rootId: '14076570:station',
  type: 'inverter',
  sn: '228326070238',
  model: 'HiOne-16T-G3'
}
```

### Gateway device

```javascript
{
  id: '14076570:gateway:28E026139783',
  plantId: '14076570',
  parentId: '14076570:inverter:228326070238',
  rootId: '14076570:station',
  type: 'gateway',
  sn: '28E026139783',
  model: 'HiBox-63T-G3'
}
```

### Battery module device

```javascript
{
  id: '14076570:battery:23C02621015E',
  plantId: '14076570',
  parentId: '14076570:inverter:228326070238',
  rootId: '14076570:station',
  type: 'battery',
  sn: '23C02621015E',
  model: 'HiOne-8B-G3'
}
```

## 9. One Driver or Multiple Drivers?

### Option A: One Flexible Driver

Structure:

```text
/drivers/hione_device/
  driver.compose.json
  driver.js
  device.js
```

In this setup, the `data.type` decides whether the device behaves as:

```text
- station
- inverter
- gateway
- battery
```

Advantages:

```text
- One pairing flow.
- User can select all discovered devices at once.
- Easier to share one API client/session.
- Easier to keep plant hierarchy together.
- Good fit for dynamic capabilities during pairing.
```

Disadvantages:

```text
- device.js needs routing logic per device type.
- Capability setup is slightly more complex.
- More conditional logic in one driver.
```

Recommendation:

```text
Use this option first.
```

---

### Option B: Multiple Drivers

Structure:

```text
/drivers/hione_station/
/drivers/hione_inverter/
/drivers/hione_gateway/
/drivers/hione_battery/
```

Advantages:

```text
- Cleaner code separation.
- Each driver has fixed capabilities.
- Easier to maintain per device type.
```

Disadvantages:

```text
- Pairing can feel fragmented.
- User may need to add station, inverter, gateway and batteries separately.
- More duplicate code unless shared libraries are used.
```

## 10. Recommended Update Architecture

Avoid every child device polling the cloud independently.

Recommended architecture:

```text
App-level polling service
        ↓
Poll Hoymiles API once per plant
        ↓
Normalise plant/device snapshot
        ↓
Find all Homey devices for plantId
        ↓
Update each related device with its own slice of data
```

Example:

```javascript
async updatePlant(plantId) {
  const snapshot = await this.homey.app.hoymilesApi.getPlantSnapshot(plantId);

  const devices = this.getDevices()
    .filter(device => device.getData().plantId === plantId);

  for (const device of devices) {
    await device.updateFromSnapshot(snapshot);
  }
}
```

Each device handles its own type:

```javascript
async updateFromSnapshot(snapshot) {
  const data = this.getData();

  if (data.type === 'station') {
    await this.updateStationCapabilities(snapshot.station);
  }

  if (data.type === 'inverter') {
    await this.updateInverterCapabilities(snapshot.inverter);
  }

  if (data.type === 'gateway') {
    await this.updateGatewayCapabilities(snapshot.gateway);
  }

  if (data.type === 'battery') {
    const battery = snapshot.batteries.find(b => b.sn === data.sn);
    await this.updateBatteryCapabilities(battery);
  }
}
```

## 11. Capability Assignment Per Device Type

### Station capabilities

```text
measure_power.pv
measure_power.battery
measure_power.grid
measure_power.load
meter_power.daily
meter_power.monthly
meter_power.yearly
meter_power.total
battery_charge_power
battery_discharge_power
grid_import_power
grid_export_power
battery_state
grid_state
self_powered
power_balance
energy_independence
system_state
connection_source
last_update
```

### Inverter capabilities

```text
phase_a_voltage
phase_b_voltage
phase_c_voltage
phase_a_current
phase_b_current
phase_c_current
phase_a_active_power
phase_b_active_power
phase_c_active_power
frequency
internal_ambient_temperature
total_bus_voltage
inverter_status
```

### Gateway capabilities

```text
gateway_online
system_state
generic_alarm
backup_state
grid_state
```

### Battery module capabilities

```text
battery_soc
battery_soh
battery_power
battery_voltage
battery_current
battery_state
max_cell_voltage
min_cell_voltage
max_cell_temperature
min_cell_temperature
fault_code
```

## 12. Recommended Polling Strategy

### Cloud/API

Use Cloud/API as the production source for now.

```text
- Poll once per plant.
- Cache the result.
- Update all related devices.
- Avoid one API call per child device.
```

### Modbus TCP / Local LAN

Use Modbus TCP only after mappings are confirmed.

For now:

```text
- Treat Modbus TCP as experimental.
- Use it for local connection status.
- Use it for diagnostics/register discovery.
- Do not update child telemetry from Modbus unless mapping confidence is confirmed.
```

## 13. Source Handling

Each device should know which source is active:

```text
cloud
local_lan
hybrid
```

### Cloud mode

```text
Station values: Cloud/API
Inverter values: Cloud/API
Gateway values: Cloud/API
Battery values: Cloud/API
Connection Source: Cloud
System State: Online (Cloud)
```

### Local LAN mode

```text
Connection Source: Local LAN
System State: Online (Local)
Only confirmed Modbus values are updated
Unknown values remain unchanged or show Unknown
```

### Hybrid mode

Recommended default:

```text
Cloud/API supplies production values
Modbus TCP supplies local availability/diagnostics
Confirmed Modbus values may override cloud values later
```

## 14. Parent/Child Relation Helpers

Example helper functions:

```javascript
function isChildOf(device, parentId) {
  return device.getData().parentId === parentId;
}

function belongsToPlant(device, plantId) {
  return device.getData().plantId === plantId;
}
```

Example lookup:

```javascript
getRelatedDevices(plantId) {
  return this.getDevices()
    .filter(device => device.getData().plantId === plantId);
}
```

## 15. Diagnostics Recommendation

Add a diagnostic view or log output that shows the internal relation model.

Example diagnostic output:

```json
{
  "plantId": "14076570",
  "devices": [
    {
      "name": "Coemans Station",
      "type": "station",
      "id": "14076570:station",
      "parentId": null
    },
    {
      "name": "Coemans Inverter - HiOne-16T-G3",
      "type": "inverter",
      "id": "14076570:inverter:228326070238",
      "parentId": "14076570:station"
    },
    {
      "name": "Coemans Gateway - HiBox-63T-G3",
      "type": "gateway",
      "id": "14076570:gateway:28E026139783",
      "parentId": "14076570:inverter:228326070238"
    },
    {
      "name": "Coemans Battery 1 - 23C02621015E",
      "type": "battery",
      "id": "14076570:battery:23C02621015E",
      "parentId": "14076570:inverter:228326070238"
    }
  ]
}
```

## 16. Recommended Implementation Roadmap

### Phase 1: Main station device

```text
- Keep existing main Station device.
- Use Cloud/API for all production values.
- Keep Modbus TCP experimental.
- Add validation to avoid invalid local values.
```

### Phase 2: Battery child devices

```text
- Add battery module discovery.
- Create one Homey device per battery module.
- Use S-Miles Cloud battery-pack data.
- Expose SOC, power, voltage and state per module.
```

Battery modules are the most useful first child devices because S-Miles exposes clear per-module data.

### Phase 3: Inverter child device

```text
- Add inverter child device.
- Expose phase voltages, currents, active power, frequency, temperature and bus voltage.
```

### Phase 4: Gateway child device

```text
- Add gateway child device.
- Expose gateway online status.
- Add firmware/hardware metadata.
- Add backup/grid-switching status if available.
```

### Phase 5: Local Modbus enhancement

```text
- Continue Modbus register discovery.
- Only map confirmed values.
- Add mapping confidence status.
- Allow local values to override cloud values only when reliable.
```

## 17. Key Design Decisions

| Design question | Recommendation |
|---|---|
| Can Homey create child devices? | Yes, as separate Homey devices with internal relations |
| Will Homey show them as a nested tree? | No |
| How to model the relation? | Store `plantId`, `parentId`, `rootId`, `type`, `sn` in `data` |
| One driver or multiple drivers? | Start with one flexible driver |
| Who polls the API? | One app-level or station-level polling service |
| Should every child poll separately? | No |
| Best first child devices? | Battery modules |
| Best production source? | Cloud/API |
| Modbus role today? | Experimental diagnostics/local status |
| Should local Modbus update production values? | Only after mapping is confirmed |

## 18. Final Recommendation

Implement the main device and child device model.

Recommended design:

```text
One flexible Homey driver
        ↓
Pairing discovers full S-Miles hierarchy
        ↓
User selects station, inverter, gateway and batteries
        ↓
Each item becomes a separate Homey device
        ↓
The app stores relations internally using plantId, parentId and serial number
        ↓
One poll per plant updates all related devices
```

Recommended production setup:

```text
Cloud/API = authoritative source for telemetry and metadata
Modbus TCP = experimental/local diagnostics until register mapping is confirmed
```

Recommended user-facing result:

```text
Coemans Station
Coemans Inverter - HiOne-16T-G3
Coemans Gateway - HiBox-63T-G3
Coemans Battery 1 - 23C02621015E
Coemans Battery 2 - 23C026210191
Coemans Battery 3 - 23C0262100E3
Coemans Battery 4 - 23C0262100E2
```

This gives a clean, scalable Homey model while preserving the S-Miles hierarchy internally.
