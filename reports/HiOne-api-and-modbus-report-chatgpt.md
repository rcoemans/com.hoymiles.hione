# HiOne API and Modbus report

**Filename:** `HiOne-api-and-modbus-report-chatgpt.md`  
**Generated:** 2026-06-18  
**Scope:** Hoymiles HiOne home battery stack consisting of HiOne-16T-G3, HiBox-63T-G3, HiOne-8B-G3, and DTS-G3 connected to HiOne-16T-G3.  
**Target platforms:** Homey and Home Assistant app development.  

---

## 1. Executive summary

The Hoymiles HiOne stack can realistically be integrated in three different ways:

1. **Hoymiles Cloud / S-Miles API**  
   This is the easiest path for discovery, station-level data, historical energy, device metadata, and some battery settings. It is **not an official public API** in the normal developer-platform sense, but several community projects have reverse-engineered the endpoints used by S-Miles / Hoymiles apps.

2. **Standard Modbus TCP, normally port 502**  
   For local, fast telemetry this is the preferred path if your DTS-G3 / HiOne exposes it. Public Hoymiles DTU-Pro Modbus documentation confirms the older Hoymiles DTU family uses Modbus TCP over Ethernet with default port **502**. The most relevant public community evidence for storage systems is a Home Assistant integration that reads **Input Registers / Function 04** from a register list generated from `Technical Note - Energy Storage MODBUS Protocol Map V1.5`.

3. **Hoymiles proprietary TCP / protobuf protocol, often port 10081**  
   Port **10081** appears in official Hoymiles DTU cloud communication port lists and is also used by community local integrations for Hoymiles DTU Wi-Fi devices. This protocol is **not normal Modbus TCP**. It uses proprietary Hoymiles frames and protobuf payloads in the community projects that support it. Treat port 10081 as an experimental/proprietary protocol path, not as a Modbus path.

### Main conclusion

For a robust Homey / Home Assistant implementation, use a layered architecture:

- **Cloud API** for station discovery, device IDs, serials, firmware, plant-level energy flow, settings read/write where permitted, and fallback telemetry.
- **Modbus TCP on port 502** for local real-time measurements and energy counters where the HiOne/DTS-G3 responds.
- **Port 10081 proprietary protocol** only as an optional experimental path, because it is not guaranteed to support HiOne/DTS-G3 storage stacks and is not equivalent to Modbus TCP.

### Documentation status

I found **publicly accessible** documentation, repositories, community integrations, and technical notes. I did **not** access private/pirated/internal documents. No official, complete, HiOne-specific public Modbus TCP register manual was found. The best public Modbus source for storage registers is a community repository that states its register list was generated from `Technical Note - Energy Storage MODBUS Protocol Map V1.5`.

---

## 2. Hoymiles components and communication picture

### HiOne stack

Hoymiles markets HiOne as a modular storage system. The official HiOne page describes modular battery expansion and a stackable battery concept. For your case:

| Component | Role in stack | Integration relevance |
|---|---|---|
| `HiOne-16T-G3` | 3-phase hybrid inverter / storage inverter | Main local Modbus target is likely exposed through inverter/DTS path. Provides PV, grid, inverter, battery, backup, and energy-flow data. |
| `HiOne-8B-G3` | Battery module | BMS values such as SOC, voltage, current, power, capacity, charge/discharge limits, BMS link/fault state. |
| `HiBox-63T-G3` | Backup/gateway device | Official page describes it as a smart gateway for home backup that communicates with Hoymiles energy storage inverters. Potential source of backup/grid state. |
| `DTS-G3` | Data transfer / cloud gateway | Official DTS-G3 page says it uploads real-time data to S-Miles Cloud via Wi-Fi, 4G, or LAN and supports remote monitoring/operation/maintenance. It may also expose local Modbus TCP depending on firmware/configuration. |

### Important port interpretation

| Port | What it likely is | Evidence / interpretation | Development advice |
|---:|---|---|---|
| `502` | Standard Modbus TCP | Hoymiles DTU-Pro technical note says Modbus TCP default port is 502. Public Modbus libraries also default to 502. | Try this first for local Modbus. Use Function 04 for the energy-storage map and Function 03 for older DTU-Pro microinverter map. |
| `10081` | Hoymiles proprietary DTU/cloud/local protocol | Official Hoymiles FAQ lists port 10081 among cloud communication ports. Homey/community integrations describe raw TCP/proprietary frames/protobuf on port 10081. | Do not treat as Modbus TCP. Use only if implementing the Hoymiles proprietary frame/protobuf protocol. |
| `10017`, `80`, `443` | Cloud / app / service communication | Listed by Hoymiles FAQ for DTU-cloud communication. | Useful for network/firewall checks, not directly for Modbus. |

---

## 3. Hoymiles Cloud / S-Miles API

### 3.1 API nature

The Hoymiles Cloud API used by community projects is reverse-engineered from S-Miles / Hoymiles app traffic. It is useful but should be treated as unstable:

- Endpoint paths and auth versions can change.
- Some accounts return read-only station data but no writable settings.
- Some regions or product lines use different hosts or auth flows.
- Settings writes are often asynchronous: submit, get job ID, poll status.

### 3.2 Hosts and auth endpoints seen in public projects

| Purpose | Host / path observed | Notes |
|---|---|---|
| Main API base | `https://neapi.hoymiles.com` | Common endpoint used by S-Miles Cloud projects. |
| EU / S-Miles Home variant | `https://euapi.hoymiles.com` | Seen in community constants for S-Miles Home / MS-A2 style flow. |
| Real-time / regional host | `https://eurt.hoymiles.com` | Seen in community constants. |
| Legacy login | `/iam/pub/0/auth/login` | Community code uses MD5 password for older API. |
| v3 pre-inspection | `/iam/pub/3/auth/pre-insp` | Used before v3 login to obtain salt/nonce data. |
| v3 login | `/iam/pub/3/auth/login` | Community code supports Argon2id/no-salt variants depending on response. |
| User profile | `/iam/api/1/user/me` | Useful to confirm authentication. |

### 3.3 API endpoint inventory for app development

The following paths are extracted from public Home Assistant integration code and should be verified against your own account/session.

| Category | Endpoint path | What it is useful for |
|---|---|---|
| Station list | `/pvm/api/0/station/select_by_page` | Discover stations/plants linked to account. |
| Station detail | `/pvm/api/0/station/find` | Station metadata and status. |
| Station settings/rules | `/pvm/api/0/station/setting_rule` | Determine available setting rules / capability exposure. |
| Station SD URI | `/pvm/api/0/station/get_sd_uri` | Additional app/station resource lookup. |
| User station settings | `/pvm/api/0/station/setting/get_user_setting` | Read station/user settings where available. |
| Price config | `/pvm/api/0/station/price/find` | Tariff/price configuration if present. |
| Battery config | `/pvm/api/0/station/setting/battery_config` | Battery mode/config data. |
| Microinverter list | `/pvm/api/0/dev/micro/select_by_station` | Microinverters attached to station. |
| Microinverter detail | `/pvm/api/0/dev/micro/find` | Microinverter metadata. |
| DTU list | `/pvm/api/0/dev/dtu/select_by_station` | DTU/DTS devices for station. |
| Inverter list | `/pvm/api/0/dev/inverter/select_by_station` | Storage/hybrid inverter discovery. |
| Battery list | `/pvm/api/0/dev/battery/select_by_station` | Battery module discovery. |
| Meter list | `/pvm/api/0/dev/meter/select_by_station` | Grid/battery/PV meter discovery. |
| Real-time station data | `/pvm-data/api/0/station/data/count_station_real_data` | Current plant-level power, battery SOC, grid/load/battery data. |
| Energy flow stats | `/pvm-data/api/0/station/data_fd/stat_g_a` | Daily/month/year energy-flow split. |
| Indicators | `/pvm-data/api/0/indicators/data/select_real_indicators_data` | Real-time indicator data by type, e.g. load/grid/PV/meter. |
| Settings read | `/pvm-ctl/api/0/dev/setting/read` | Asynchronous device setting read. |
| Settings write | `/pvm-ctl/api/0/dev/setting/write` | Asynchronous device setting write. Use with care. |
| Settings status | `/pvm-ctl/api/0/dev/setting/status` | Poll read/write job result. |
| EPS settings | `/eps/api/0/setting/g_a` | EPS/backup settings where exposed. |
| EPS profit/stat | `/eps/api/0/record/stat_a` | EPS-related stats/profit where exposed. |
| AI/status | `/pvm-ai/api/0/station/sar_g_c` | Station AI/status endpoint seen in code. |
| Firmware compare | `/pvm/api/0/upgrade/compare` | Firmware/upgrade comparison data. |

### 3.4 Battery operation modes seen in community code

Community constants expose the following battery mode IDs:

| ID | Mode |
|---:|---|
| `1` | Self-consumption |
| `2` | Economy |
| `3` | Backup |
| `4` | Off-grid |
| `5` | Self-consumption + max power |
| `6` | Backup + max power |
| `7` | Peak shaving |
| `8` | Time of use |

Known action IDs from community code:

| Action ID | Meaning |
|---:|---|
| `1013` | Battery settings |
| `1014` | Relay |
| `1030` | Inverter config |

### 3.5 API fields used by the Home Assistant cloud integration

Public HA code maps the following API fields into sensors. These are useful names for your Homey and Home Assistant data model.

| Home automation data element | API object/key observed | Notes |
|---|---|---|
| PV power | `real_time_data.real_power` | Station-level current PV power. |
| Grid power | `reflux_data.grid_power` | Direction/sign must be validated against S-Miles UI. |
| Load power | `reflux_data.load_power` | Home load / consumption. |
| Battery power | `reflux_data.bms_power` | Validate sign convention for charge/discharge. |
| Battery SOC | `reflux_data.bms_soc` | Battery percentage. |
| Today PV energy | `real_time_data.today_eq` | Daily energy. |
| Month PV energy | `real_time_data.month_eq` | Monthly energy. |
| Year PV energy | `real_time_data.year_eq` | Yearly energy. |
| Total PV energy | `real_time_data.total_eq` | Total production. |
| PV → load energy | `pv_to_load_eq` | Flow metric; exact nesting can vary by response. |
| Grid import energy | `meter_b_in_eq` | Often nested for day/month/year/total. |
| Grid export energy | `meter_b_out_eq` | Often nested for day/month/year/total. |
| Battery charge energy | `bms_in_eq` | Energy into battery. |
| Battery discharge energy | `bms_out_eq` | Energy out of battery. |
| Total load/use energy | `use_eq_total` | Load / consumption total. |
| PV → battery | energy-flow key `p2b` | Energy-flow endpoint. |
| PV → grid | energy-flow key `p2g` | Energy-flow endpoint. |
| PV → load | energy-flow key `p2l` | Energy-flow endpoint. |
| Load from PV | energy-flow key `lfp` | Energy-flow endpoint. |
| Load from battery | energy-flow key `lfb` | Energy-flow endpoint. |
| Load from grid | energy-flow key `lfg` | Energy-flow endpoint. |
| EV charger power/status | EV charger keys in integration | Only relevant if Hoymiles EV charger present. |

---

## 4. Modbus TCP for HiOne / energy storage

### 4.1 Standard Modbus expectations

For standard Modbus TCP:

- The service usually listens on **TCP port 502**.
- Requests contain an MBAP header, then function code and register request.
- A valid response should echo the transaction ID and protocol ID `0x0000` in the MBAP header.
- For the public energy-storage map used by `ha-hoymiles-modbus`, reads are **Input Registers / Function 04**.
- Older Hoymiles DTU-Pro microinverter docs use **Holding Registers / Function 03** for device data and also document write functions for control.

### 4.2 Why port 10081 should not be called Modbus TCP

Port 10081 is important but different:

- Official Hoymiles FAQ lists port 10081 as a DTU/cloud communication port.
- The Homey community integration for local Hoymiles DTU access describes raw TCP on port 10081 using proprietary Hoymiles frames and protobuf payloads.
- The `hoymiles-wifi` library supports local communication with Hoymiles DTUs, Wi-Fi microinverters, and some hybrid inverter families using protobuf messages.

Therefore:

> **Treat port 10081 as Hoymiles proprietary local/cloud transport, not as Modbus TCP.**

If you send a normal Modbus TCP request to port 10081 and do not receive an MBAP-style Modbus response, that is expected.

---

## 5. Public energy-storage Modbus register map candidate

The most relevant public register source found is `isjo-org/ha-hoymiles-modbus`. Its README states that it reads **Input Registers / Function 04** via Modbus TCP or RTU and creates sensors for known registers. The repository’s `registers.py` says it is auto-generated from `Technical Note-Energy Storage MODBUS Protocol Map V1.5`.

Important caveat:

- This is **not an official Hoymiles public document**.
- It appears highly relevant to storage/hybrid systems and G3 models.
- You should validate every register against your own HiOne/DTS-G3 by comparing values with S-Miles/API at the same timestamp.

### 5.1 Register interpretation rules from the community map

| Parameter | Observed value |
|---|---|
| Modbus function | Function 04 / Input Registers |
| Addressing | Address offset configurable: `0` default, optional `1` if device/tools are one-based |
| Word order | Big by default, configurable |
| Byte order | Big by default, configurable |
| Model mode | `auto`, `g1g2`, `g3`; G3 differs for battery current/power register width |
| G3 battery current | Address `48`, type `I32`, scale `100` |
| G3 battery power | Address `50`, type `I32`, scale `1` |

### 5.2 Core HiOne / energy-storage registers to test first

These are the highest-value registers for a Homey / Home Assistant integration.

| Data element | Register address | Type | Scale | Unit | Notes |
|---|---:|---|---:|---|---|
| Work status | `0` | `U16` | `1` | - | Description includes `4: FaultMode`; verify full status mapping. |
| Power DSP firmware version | `1` | `U16` | `1` | - | Inverter firmware-like value. |
| Software fault code | `19` | `H32` | `1` | - | Fault diagnostics. |
| Hardware fault code | `21` | `H32` | `1` | - | Fault diagnostics. |
| PV total power | `26` | `U16` | `1` | W | Sum of PV input power. |
| PV1 voltage | `27` | `U16` | `10` | V | Divide by 10. |
| PV1 current | `28` | `I16` | `100` | A | Divide by 100. |
| PV1 power | `29` | `U16` | `1` | W | MPPT/PV string power. |
| PV2 voltage/current/power | `30`/`31`/`32` | `U16`/`I16`/`U16` | `10`/`100`/`1` | V/A/W | Same pattern as PV1. |
| PV3 voltage/current/power | `33`/`34`/`35` | `U16`/`I16`/`U16` | `10`/`100`/`1` | V/A/W | Same pattern as PV1. |
| PV4 voltage/current/power | `36`/`37`/`38` | `U16`/`I16`/`U16` | `10`/`100`/`1` | V/A/W | Same pattern as PV1. |
| Battery total power | `45` | `I16` | `1` | W | Quick total battery power; compare with G3-specific Bat1 Power. |
| Battery voltage | `46` | `U16` | `10` | V | Divide by 10. |
| Battery current, G3 | `48` | `I32` | `100` | A | G3-specific; spans two registers. |
| Battery power, G3 | `50` | `I32` | `1` | W | G3-specific; spans two registers. |
| Bus voltage | `60` | `U16` | `10` | V | DC bus voltage. |
| Grid voltage A/B/C | `62`/`63`/`64` | `U16` | `10` | V | Phase voltages. |
| Grid frequency | `66` | `U16` | `100` | Hz | Divide by 100. |
| Inverter voltage A/B/C | `67`/`68`/`69` | `U16` | `10` | V | Inverter-side voltage. |
| Inverter current A/B/C | `70`/`71`/`72` | `I16` | `100` | A | Inverter-side current. |
| Inverter active power total | `73` | `I16` | `1` | W | Combined active power. |
| Inverter active power A/B/C | `74`/`75`/`76` | `I16` | `1` | W | Per-phase active power. |
| Inverter reactive power total | `77` | `I16` | `1` | Var | Combined reactive power. |
| Backup voltage A/B/C | `81`/`82`/`83` | `U16` | `10` | V | Backup output voltage. |
| Backup current A/B/C | `84`/`85`/`86` | `I16` | `100` | A | Backup output current. |
| Backup apparent power total | `87` | `I16` | `1` | VA | Backup apparent power. |
| Backup active power total | `91` | `I16` | `1` | W | Backup active power. |
| PV heatsink temperature | `112` | `I16` | `1` | °C likely | Source has corrupted unit symbol; validate. |
| Inverter heatsink temperature | `113` | `I16` | `1` | °C likely | Validate. |
| Battery-side heatsink temperature | `114` | `I16` | `1` | °C likely | Validate. |
| Ambient temperature | `115` | `I16` | `1` | °C likely | Validate. |
| Internal fan speeds | `121`/`122`/`123` | `U16` | `1` | rpm | Internal fans. |
| External fan speeds | `153`-`156` | `U16` | `1` | rpm | External fans. |
| Safety DSP firmware version | `201` | `U16` | `1` | - | Firmware/version. |
| Reconnect counter | `210` | `U16` | `1` | s | Grid reconnect timer. |
| PE voltage | `241` | `I16` | `10` | V | Safety/diagnostics. |
| Insulation resistance | `242` | `U16` | `1` | kΩ | Safety/diagnostics. |
| Residual current | `243` | `I16` | `1` | mA | Leakage current. |

### 5.3 Battery/BMS registers

| Data element | Register address | Type | Scale | Unit | Notes |
|---|---:|---|---:|---|---|
| Battery type | `1021` | `U16` | `1` | - | `0=None`, `1=Li-ion`, `2=Lead-Acid` in community map. |
| BMS link status | `1022` | `U16` | `1` | - | `0=fail`, `1=OK`. |
| BMS fault code | `1023` | `U16` | `1` | - | Decode still needs field validation. |
| Battery capacity | `1024` | `U16` | `10` | kWh | Divide by 10. |
| Battery SOC | `1025` | `U16` | `1` | % | Very important Homey/HA sensor. |
| Charge cutoff voltage | `1026` | `U16` | `10` | V | Divide by 10. |
| Discharge cutoff voltage | `1027` | `U16` | `10` | V | Divide by 10. |
| Max charge current | `1028` | `U16` | `100` | A | Divide by 100. |
| Max discharge current | `1029` | `U16` | `100` | A | Divide by 100. |

### 5.4 Grid/meter registers

| Data element | Register address | Type | Scale | Unit | Notes |
|---|---:|---|---:|---|---|
| Grid-side meter link status | `1046` | `U16` | `1` | - | `0=fail`, `1=OK`. |
| Grid-side meter voltage A/B/C | `1047`/`1048`/`1049` | `U16` | `10` | V | Meter-side voltage. |
| Grid-side meter frequency | `1053` | `U16` | `100` | Hz | Divide by 100. |
| DRM status | `1060` | `U16` | `1` | - | Demand response / grid control state. |
| PV-side meter link status | `1061` | `U16` | `1` | - | `0=fail`, `1=OK`. |
| Grid active power A/B/C | `1078`/`1080`/`1082` | `I32` | `1` | W | Sum can be used as grid power. Validate sign: import/export. |
| Grid reactive power A/B/C | `1084`/`1086`/`1088` | `I32` | `1` | Var | Reactive power per phase. |
| PV inverter active power A/B/C | `1090`/`1092`/`1094` | `I32` | `1` | W | PV inverter/meter phase power. |

### 5.5 Energy counter registers

All energy counters below should be treated as Home Assistant `state_class: total_increasing` if they are confirmed to be monotonically increasing. The scale `10` means the raw value should be divided by 10.

| Data element | Register address | Type | Scale | Unit | Notes |
|---|---:|---|---:|---|---|
| PV total energy | `2000` | `I32` | `10` | kWh | Cumulative PV generation. |
| External PV energy total | `2014` | `I32` | `10` | kWh | External PV total. |
| PV → battery energy total | `2022` | `I32` | `10` | kWh | Cumulative PV to battery. |
| PV → load energy total | `2024` | `I32` | `10` | kWh | Cumulative PV to load. |
| PV → grid energy total | `2026` | `I32` | `10` | kWh | Cumulative PV export. |
| Battery charge energy total | `2028` | `I32` | `10` | kWh | Cumulative charge. |
| Battery discharge energy total | `2030` | `I32` | `10` | kWh | Cumulative discharge. |
| Grid buy/import energy total | `2040` | `I32` | `10` | kWh | Cumulative grid import. |
| Grid sell/export energy total | `2048` | `I32` | `10` | kWh | Cumulative grid export. |
| Load energy use total | `2056` | `I32` | `10` | kWh | Cumulative load use. |
| Energy from PV total | `2064` | `I32` | `10` | kWh | Load/source breakdown. |
| Energy from battery total | `2066` | `I32` | `10` | kWh | Load/source breakdown. |
| Energy from grid total | `2068` | `I32` | `10` | kWh | Load/source breakdown. |
| Load energy total | `2070` | `I32` | `10` | kWh | Cumulative load total. |
| PV today total energy | `2100` | `U16` | `10` | kWh | Daily PV generation. |
| External PV today energy | `2107` | `U16` | `10` | kWh | Daily external PV. |
| PV → battery energy today | `2111` | `U16` | `10` | kWh | Daily PV to battery. |
| PV → load energy today | `2112` | `U16` | `10` | kWh | Daily PV to load. |
| PV → grid energy today | `2113` | `U16` | `10` | kWh | Community key name says total, register context says today; validate. |
| Battery charge energy today | `2114` | `U16` | `10` | kWh | Daily charge. |
| Battery discharge energy today | `2115` | `U16` | `10` | kWh | Daily discharge. |
| Grid buy/import energy today | `2120` | `U16` | `10` | kWh | Daily import. |
| Grid sell/export energy today | `2124` | `U16` | `10` | kWh | Daily export. |
| Energy from PV today | `2132` | `U16` | `10` | kWh | Daily load-source split. |
| Energy from battery today | `2133` | `U16` | `10` | kWh | Daily load-source split. |
| Energy from grid today | `2134` | `U16` | `10` | kWh | Daily load-source split. |
| Generator energy today | `2135` | `U16` | `10` | kWh | If generator port is used. |

### 5.6 EV charger registers in the same map

These are probably irrelevant unless a Hoymiles EV charger is attached.

| Data element | Register address | Type | Scale | Unit |
|---|---:|---|---:|---|
| EV charger connect status | `3200` | `U16` | `1` | - |
| EV charger communication address | `3201` | `U16` | `1` | - |
| EV charger serial number | `3202` | `U64` | `1` | - |
| EV charger software version | `3209` | `U16` | `1` | - |
| EV charger min charge power | `3211` | `U16` | `10` | kW |
| EV charger error code | `3213` | `U16` | `1` | - |
| EV charger real output power | `3215` | `U16` | `1` | likely W or configured unit; validate |
| EV charger output voltage | `3220` | `U16` | `10` | V |
| EV charger output current | `3221` | `U16` | `10` | A |
| EV charger output power | `3222` | `U16` | `10` | kW |
| EV charger output time | `3223` | `U16` | `1` | min |
| EV charger output capacity | `3224` | `U16` | `10` | kWh |

---

## 6. Older Hoymiles DTU-Pro microinverter Modbus map

This map is useful for understanding Hoymiles Modbus style, but it is **not a HiOne storage map**.

The public Hoymiles DTU-Pro technical note documents:

- Ethernet Modbus TCP.
- Default Modbus TCP port: `502`.
- Supported functions: `01`, `02`, `03`, `05`, `15`.
- Device data read with Function `03`.
- Microinverter port register blocks starting at `0x1000`.

### 6.1 Microinverter data block pattern

For port `N`:

```text
base = 0x1000 + 0x28 * (N - 1)
```

| Offset from base | Example port 1 address | Data element | Unit / scale |
|---:|---:|---|---|
| `0x00` | `0x1000` | Data type | Default `0x3C` |
| `0x01`-`0x06` | `0x1001`-`0x1006` | Microinverter serial number | 12-digit decimal, big-endian |
| `0x07` | `0x1007` | Port number | - |
| `0x08`-`0x09` | `0x1008`-`0x1009` | PV voltage | V, 1 decimal |
| `0x0A`-`0x0B` | `0x100A`-`0x100B` | PV current | A, 1 or 2 decimals depending model |
| `0x0C`-`0x0D` | `0x100C`-`0x100D` | Grid voltage | V, 1 decimal |
| `0x0E`-`0x0F` | `0x100E`-`0x100F` | Grid frequency | Hz, 2 decimals |
| `0x10`-`0x11` | `0x1010`-`0x1011` | PV power | W, 1 decimal |
| `0x12`-`0x13` | `0x1012`-`0x1013` | Today production | Wh |
| `0x14`-`0x17` | `0x1014`-`0x1017` | Total production | Wh |
| `0x18`-`0x19` | `0x1018`-`0x1019` | Temperature | °C, 1 decimal |
| `0x1A`-`0x1B` | `0x101A`-`0x101B` | Operating status | code |
| `0x1C`-`0x1D` | `0x101C`-`0x101D` | Alarm code | code |
| `0x1E`-`0x1F` | `0x101E`-`0x101F` | Alarm count | count |
| `0x20` | `0x1020` | Link status | code |
| `0x21` | `0x1021` | Fixed value | `0x07` |
| `0x22`-`0x27` | `0x1022`-`0x1027` | Reserved | - |

### 6.2 Older DTU-Pro control examples

Do **not** write these registers to a HiOne unless you have confirmed they apply to your device and understand the effect.

| Register | Function | Meaning |
|---:|---|---|
| `0xC000` | FC05 write single coil/register per technical note wording | Turn ON/OFF all microinverters; `0=OFF`, `1=ON`. |
| `0xC001` | FC05 write | Limit active power all microinverters, percentage. |
| `0xC006` | FC05 write | Port 1 turn ON/OFF. |
| `0xC007` | FC05 write | Port 1 active power limit. |
| `0xC00C` | FC05 write | Port 2 turn ON/OFF. |
| `0xC00D` | FC05 write | Port 2 active power limit. |
| `0x9D9C` | FC05 write | Alternative all-microinverters ON/OFF block near max port range. |
| `0x9D9D` | FC05 write | Alternative all-microinverters power limit block. |

---

## 7. Cross-source mapping table for Homey / Home Assistant

This table maps the most important home automation data elements to possible API and Modbus sources.

**Legend**

- **API:** observed in public cloud integration code.
- **Modbus ES:** energy-storage Modbus map candidate from community repo.
- **Modbus DTU-Pro:** older microinverter-only DTU-Pro map; only relevant for PV/microinverter data, not battery stack control.
- **Confidence:**
  - `High` = public source directly exposes field/register and concept fits HiOne storage.
  - `Medium` = field/register exists but sign/semantics must be validated.
  - `Low` = older microinverter map or indirect inference.

| Data element | API source | Modbus ES candidate | Modbus DTU-Pro candidate | Confidence | App notes |
|---|---|---|---|---|---|
| Station / plant ID | `/station/select_by_page`, `/station/find` | Not a register | Not a register | High API | Use API for discovery and unique IDs. |
| DTU/DTS serial | `/dev/dtu/select_by_station` | Not found in ES map excerpt | DTU SN `0x2000`-`0x2005` in DTU-Pro doc | Medium | Prefer API for DTS metadata. |
| Inverter serial/model | `/dev/inverter/select_by_station` | Not clearly in ES map excerpt | Microinverter SN per port | Medium | Use API first. |
| Battery module serial/model | `/dev/battery/select_by_station` | Not clearly in ES map excerpt | N/A | Medium | Use API first. |
| Firmware versions | `/upgrade/compare`, device endpoints | `1`, `201`, EV `3209` | Various DTU/micro fields | Medium | Expose as diagnostic entities. |
| Work / operating status | API station/device detail, possibly real-time data | `0` WorkStatus | `0x101A`-`0x101B` per micro port | Medium | Need status code dictionary. |
| Fault / alarm | API alarms/device detail where present | `19` SW fault, `21` HW fault, `1023` BMS fault | `0x101C`-`0x101F` alarm code/count | Medium | Expose raw code until decoded. |
| PV total power | `real_time_data.real_power` | `26` PV Total Power | sum port PV power `0x1010` blocks | High | Compare API vs Modbus live. |
| PV string voltage/current/power | Indicator/device endpoints may expose channels | `27`-`38` PV1-PV4 | per-port voltage/current/power | High Modbus | Good diagnostic sensors. |
| Grid power total | `reflux_data.grid_power` | Sum `1078+1080+1082` Grid Active Power phases | N/A | Medium | Sign convention must be validated. |
| Grid voltage/frequency | indicators grid; device detail | `62`-`66` and `1047`-`1053` | grid voltage/frequency in micro block | High | Choose inverter side or meter side consistently. |
| Load power | `reflux_data.load_power` | Derive from flow or meter data; no single obvious `load_power` register in extracted core | N/A | Medium | Could calculate from source flows if registers validate. |
| Battery power | `reflux_data.bms_power` | `45` Bat Total Power; G3 `50` Bat1 Power I32 | N/A | High | Validate sign: charge vs discharge. |
| Battery current | not always station-level | G3 `48` Bat1 Current I32 / scale 100 | N/A | High | Critical for storage diagnostics. |
| Battery voltage | maybe battery endpoint | `46` Bat1 Voltage / scale 10 | N/A | High | Confirm against BMS/API. |
| Battery SOC | `reflux_data.bms_soc` | `1025` Battery SOC | N/A | High | Core battery entity. |
| Battery capacity | battery endpoint | `1024` Battery Capacity / scale 10 | N/A | High | For stack size validation. |
| BMS link status | battery endpoint / alarm | `1022` BMS Link Status | N/A | High | Device availability diagnostic. |
| BMS fault code | battery endpoint / alarm | `1023` BMS Fault Code | N/A | Medium | Raw until decoded. |
| Charge/discharge limits | battery settings/config | `1028`, `1029` max charge/discharge current | N/A | Medium | Avoid writing limits until confirmed. |
| Backup voltage/current/power | EPS endpoints likely | `81`-`94` | N/A | High | Useful for HiBox/backup child device. |
| Generator port values | not likely unless configured | `103`-`111`, `2135` | N/A | Medium | Hide unless non-zero/available. |
| Internal temperatures | device detail/diagnostics maybe | `112`-`115` | micro temp per port | High Modbus | Unit symbol in community map is corrupted; likely °C. |
| Fan speeds | not likely in API | `121`-`123`, `153`-`156` | N/A | Medium | Diagnostic only. |
| PV total energy | `total_eq`; energy-flow endpoints | `2000` PV Total Energy | micro total production | High | Use kWh state class total_increasing. |
| PV today energy | `today_eq` | `2100` PV Today Total Energy | micro today production | High | Daily reset sensor. |
| Grid import total/today | `meter_b_in_eq` | `2040`, `2120` | N/A | High | Validate import/export naming with meter sign. |
| Grid export total/today | `meter_b_out_eq` | `2048`, `2124` | N/A | High | Validate import/export naming with meter sign. |
| Battery charge total/today | `bms_in_eq` | `2028`, `2114` | N/A | High | Good energy dashboard entities. |
| Battery discharge total/today | `bms_out_eq` | `2030`, `2115` | N/A | High | Good energy dashboard entities. |
| PV → battery total/today | energy-flow key `p2b` | `2022`, `2111` | N/A | High | Energy-flow diagram. |
| PV → load total/today | `pv_to_load_eq`, key `p2l` | `2024`, `2112` | N/A | High | Energy-flow diagram. |
| PV → grid total/today | key `p2g` | `2026`, `2113` | N/A | Medium | Address `2113` naming mismatch: validate. |
| Load from PV total/today | energy-flow key `lfp` | `2064`, `2132` | N/A | High | Flow diagram. |
| Load from battery total/today | energy-flow key `lfb` | `2066`, `2133` | N/A | High | Flow diagram. |
| Load from grid total/today | energy-flow key `lfg` | `2068`, `2134` | N/A | High | Flow diagram. |
| Load energy total | `use_eq_total` | `2056` or `2070` | N/A | Medium | Determine which matches S-Miles UI. |
| Battery operation mode | API setting/config endpoints | Not in read-only ES map excerpt | N/A | High API | Cloud likely best source/control. |
| Reserve SOC | API settings | Not in read-only ES map excerpt | N/A | High API | Cloud setting read/write if account supports it. |
| Peak shaving settings | API settings/action IDs | Not in read-only ES map excerpt | N/A | High API | Cloud setting read/write if account supports it. |
| EV charger values | API if present | `3200`-`3224` | N/A | Medium | Hide unless EV charger is discovered. |

---

## 8. Recommended validation workflow

The biggest risk is assuming a register map applies to your exact HiOne/DTS-G3 firmware. Validate in small steps.

### 8.1 Network discovery

```bash
# Replace with the DTS-G3 / HiOne IP address
nmap -sV -p 502,10081,80,443,10017 <DTS_IP>
```

Expected interpretation:

| Result | Meaning |
|---|---|
| `502/tcp open` | Try standard Modbus TCP. |
| `10081/tcp open` | Proprietary Hoymiles protocol may be available. Not proof of Modbus. |
| Only `80/443` open | Web/cloud support may exist but not local Modbus. |
| No local ports | Device may be firewalled, on another VLAN, or local service disabled. |

### 8.2 Minimal Modbus TCP test, Function 04

Use the energy-storage map first with Function 04 / input registers.

```python
from pymodbus.client import ModbusTcpClient

HOST = "<DTS_OR_HIONE_IP>"
PORT = 502
UNIT_ID = 1

client = ModbusTcpClient(HOST, port=PORT, timeout=3)
try:
    if not client.connect():
        raise RuntimeError("Cannot connect")

    # Battery SOC candidate: input register 1025, one register, scale 1
    rr = client.read_input_registers(address=1025, count=1, slave=UNIT_ID)
    if rr.isError():
        print("Modbus error:", rr)
    else:
        print("Battery SOC raw:", rr.registers[0], "=>", rr.registers[0], "%")
finally:
    client.close()
```

For older `pymodbus` versions, the keyword can be `unit=UNIT_ID` instead of `slave=UNIT_ID`.

### 8.3 Test the G3 battery power registers

```python
from pymodbus.client import ModbusTcpClient

HOST = "<DTS_OR_HIONE_IP>"
client = ModbusTcpClient(HOST, port=502, timeout=3)

def i32_be(words):
    raw = (words[0] << 16) | words[1]
    if raw & 0x80000000:
        raw -= 0x100000000
    return raw

try:
    client.connect()

    # Battery current G3: address 48, I32, scale 100
    rr = client.read_input_registers(address=48, count=2, slave=1)
    if not rr.isError():
        print("Battery current A:", i32_be(rr.registers) / 100)

    # Battery power G3: address 50, I32, scale 1
    rr = client.read_input_registers(address=50, count=2, slave=1)
    if not rr.isError():
        print("Battery power W:", i32_be(rr.registers))
finally:
    client.close()
```

### 8.4 Determine sign convention

Do this during clear charge/discharge situations:

| Situation | Expected physical state | What to record |
|---|---|---|
| Midday with PV surplus | Battery likely charging | API `bms_power`, Modbus `45`/`50`, SOC rising. |
| Evening with load | Battery likely discharging | API `bms_power`, Modbus `45`/`50`, SOC falling. |
| Battery idle/full | Battery power near zero | Check noise/offset and sign. |
| Grid import | House load > PV + battery | API grid power, Modbus grid phase sum. |
| Grid export | PV > load + battery charge | API grid power, Modbus grid phase sum. |

Then document your local convention in code:

```text
battery_power_positive_means = "charging" or "discharging"
grid_power_positive_means = "import" or "export"
```

Do not rely on naming alone.

### 8.5 Address offset trap

Some tools call register `1025` exactly. Others require `1026` because they use 1-based display addressing. The community HA integration explicitly supports address offset `0` or `1`.

Validation trick:

- Read register `1025` and `1026`.
- Compare with S-Miles battery SOC.
- The SOC should be a plausible integer `0..100`.

### 8.6 Unit ID scan

Try `unit_id` / `slave_id` values:

```text
1, 2, 3, 10, 100, 247, 254
```

Older examples often use `1` for TCP clients or installer-configured values for RTU. Some RS485 examples use `254`. For Modbus TCP via a gateway, the unit ID may or may not matter depending on firmware.

---

## 9. Home Assistant design recommendation

### 9.1 Entity model

Create devices like this:

```text
Hoymiles Station / Plant
├── HiOne-16T-G3 Inverter
│   ├── PV sensors
│   ├── Grid sensors
│   ├── Inverter phase sensors
│   ├── Energy counters
│   └── Diagnostics/faults
├── HiOne-8B-G3 Battery Module(s)
│   ├── SOC
│   ├── Voltage/current/power
│   ├── Capacity
│   ├── BMS status/fault
│   └── Charge/discharge counters
├── HiBox-63T-G3 Gateway / Backup
│   ├── Backup voltage/current/power
│   ├── EPS settings/status
│   └── Backup availability
└── DTS-G3 Gateway
    ├── Online status
    ├── Signal/network/cloud state if available
    └── Firmware/serial metadata
```

### 9.2 Integration layers

| Layer | Purpose | Update interval suggestion |
|---|---|---:|
| Local Modbus TCP | Real-time power, SOC, voltage/current, energy counters | 5-30 seconds; start with 15s |
| Cloud API | Discovery, metadata, settings, fallback data | 60-300 seconds |
| Cloud settings/control | Battery mode/reserve SOC/peak shaving | On user action plus status polling |
| Proprietary port 10081 | Experimental local DTU protocol | 30+ seconds; do not hammer |

### 9.3 Home Assistant entity classes

| Data type | HA device class | HA state class |
|---|---|---|
| Power W | `power` | `measurement` |
| Energy kWh total | `energy` | `total_increasing` |
| Energy today | `energy` | `total` or daily-reset sensor; avoid long-term total unless monotonic |
| Voltage V | `voltage` | `measurement` |
| Current A | `current` | `measurement` |
| Frequency Hz | `frequency` | `measurement` |
| Temperature °C | `temperature` | `measurement` |
| Battery SOC % | `battery` | `measurement` |
| Fault/status codes | none | none |

### 9.4 Home Assistant minimal Modbus YAML example

This is just for quick manual testing, not necessarily your final custom integration.

```yaml
modbus:
  - name: hione_modbus
    type: tcp
    host: 192.168.1.123
    port: 502
    sensors:
      - name: HiOne Battery SOC
        slave: 1
        input_type: input
        address: 1025
        data_type: uint16
        unit_of_measurement: "%"
        scale: 1
        precision: 0

      - name: HiOne PV Total Power
        slave: 1
        input_type: input
        address: 26
        data_type: uint16
        unit_of_measurement: W
        scale: 1
        precision: 0

      - name: HiOne Grid Frequency
        slave: 1
        input_type: input
        address: 66
        data_type: uint16
        unit_of_measurement: Hz
        scale: 0.01
        precision: 2
```

For 32-bit signed registers such as G3 battery power, use HA’s `int32` type if your HA version supports it, with the correct byte/word order.

---

## 10. Homey app design recommendation

### 10.1 Device strategy

For Homey, the same main/child model works well:

| Homey device | Capabilities |
|---|---|
| Main station device | Plant mode, total power flow, total daily/month/year/yearly energy, online state. |
| Inverter child | Phase voltage/current/power, PV power, grid import/export, frequency, temperatures, faults. |
| Battery child | SOC, battery power, charge/discharge state, voltage, current, BMS status/fault, capacity. |
| HiBox child | Backup power/voltage/current, EPS status/settings if available. |
| DTS-G3 child | Cloud/local connectivity, firmware, serial, last update. |

### 10.2 Homey capability suggestions

| Data | Homey capability suggestion |
|---|---|
| PV power | `measure_power` or custom `measure_power.pv` |
| Load power | custom `measure_power.load` |
| Grid power | custom split `measure_power.grid_import` / `measure_power.grid_export` or signed grid power |
| Battery SOC | `measure_battery` |
| Battery power | custom `measure_power.battery` |
| Energy counters | `meter_power` variants or custom cumulative capabilities |
| Temperature | `measure_temperature` variants |
| Fault state | `alarm_generic` plus custom fault code |
| Online state | `alarm_connectivity` or custom boolean |

### 10.3 Homey local Modbus pseudo-code

```javascript
const ModbusRTU = require("modbus-serial");

async function readHiOne(host) {
  const client = new ModbusRTU();
  await client.connectTCP(host, { port: 502 });
  client.setID(1);
  client.setTimeout(3000);

  try {
    // Function 04 / input register: Battery SOC at 1025
    const soc = await client.readInputRegisters(1025, 1);
    const batterySoc = soc.data[0];

    // PV total power at 26
    const pv = await client.readInputRegisters(26, 1);
    const pvPower = pv.data[0];

    return { batterySoc, pvPower };
  } finally {
    client.close(() => {});
  }
}
```

For G3 `I32` values, combine two 16-bit registers and sign-extend.

---

## 11. Repositories and projects found

| Project / source | Relevance | Notes |
|---|---|---|
| `Philra94/hoymiles-cloud` | Very high for Cloud API | HA integration for Hoymiles Cloud focused on HYT/battery systems; exposes PV, battery, grid, load, energy flow, battery settings. |
| `isjo-org/ha-hoymiles-modbus` | Very high for energy-storage Modbus | Reads Input Registers / Function 04 from a list generated from `Technical Note - Energy Storage MODBUS Protocol Map V1.5`; includes G3-specific battery current/power width handling. |
| `wil-lem/ha-hoymiles-modbus-tcp` | Medium for older DTU Modbus | HA integration for Hoymiles DTU Modbus TCP; mainly microinverter production and power limiting. |
| `wasilukm/hoymiles_modbus` | Medium for older DTU Modbus | Python Modbus TCP client for DTU-managed PV installation; default port 502, unit ID 1. |
| `ArekKubacki/Hoymiles-Plant-DTU-Pro` | Medium for DTU-Pro Modbus | DTU-Pro Modbus TCP project; useful for older microinverter/DTU behavior and RS485 setting caveats. |
| `suaveolent/hoymiles-wifi` | Medium/high for proprietary local protocol | Python library for local Hoymiles DTU/Wi-Fi/hybrid inverter communication using protobuf messages. Supported models do not explicitly list HiOne in the source I saw. |
| `ha-hoymiles-wifi` community integrations | Medium for port 10081/protobuf path | Useful if your DTS-G3 behaves like supported DTU Wi-Fi devices. |
| Homey community Hoymiles DTU app | Medium for Homey local protocol | Describes raw TCP port 10081, proprietary HM frames, protobuf payload, daytime polling. |
| `dmslabsbr/hoymiles` | Low/medium for cloud API history | Older unofficial API/add-on; issues mention paid docs and API version mismatch. |
| OpenDTU / OpenDTU-OnBattery | Low for HiOne, high for microinverter ecosystems | Alternative DTU approach; mainly for Hoymiles solar microinverters and some battery peripherals, not a direct HiOne/DTS-G3 solution. |

---

## 12. Recommended implementation roadmap

### Phase 1 — Cloud API integration

1. Implement login with region/host strategy.
2. Discover stations.
3. Discover DTS/inverter/battery/meter devices.
4. Expose station-level sensors from real-time data.
5. Expose battery settings as read-only first.
6. Add writes only after status-poll workflow is implemented.

### Phase 2 — Local Modbus TCP read-only

1. Config: host, port default `502`, unit ID default `1`, timeout, address offset `0/1`, word order, byte order.
2. Read small register groups first: `0`, `26`, `45`, `48`, `50`, `62`, `66`, `1025`.
3. Compare with S-Miles/API snapshot.
4. Add energy counters after current values validate.
5. Add diagnostics/faults last.

### Phase 3 — Data reconciliation

Build a runtime comparison screen/log:

```json
{
  "timestamp": "2026-06-18T12:00:00+02:00",
  "api": {
    "pv_power": 3200,
    "grid_power": -500,
    "battery_power": 1200,
    "battery_soc": 66
  },
  "modbus": {
    "pv_total_power_26": 3198,
    "grid_power_sum_1078_1080_1082": -502,
    "bat_total_power_45": 1199,
    "bat1_power_g3_50": 1200,
    "battery_soc_1025": 66
  }
}
```

This comparison is the fastest way to finish the Modbus mapping with confidence.

### Phase 4 — Controls

Use controls only after read-only telemetry is stable.

| Control | Preferred source | Risk |
|---|---|---|
| Battery mode | Cloud API settings | Medium; async job/status handling needed. |
| Reserve SOC | Cloud API settings | Medium; must respect account permissions. |
| Peak shaving | Cloud API settings | Medium/high; wrong values affect power behavior. |
| Power limit / inverter on/off | Older DTU-Pro Modbus map only for microinverters | High if applied to HiOne without confirmed register map. |
| Modbus writes to HiOne | Not recommended without official write map | High. |

---

## 13. Open questions to solve with real captures

These are the items that still require your live stack, because public documentation is incomplete.

| Question | How to answer |
|---|---|
| Does your DTS-G3 expose Modbus TCP on port 502? | Port scan and Function 04 read tests. |
| Does your DTS-G3 expose proprietary Hoymiles local protocol on 10081? | TCP connect and hoymiles-wifi/protobuf test. |
| Is Unit ID `1` correct? | Scan likely unit IDs. |
| Is address offset `0` or `1`? | Compare SOC register `1025` vs `1026`. |
| Which sign means battery charging? | Compare during known charging/discharging. |
| Which sign means grid import/export? | Compare during known import/export. |
| Which load energy counter matches S-Miles UI? | Compare `2056`, `2070`, API `use_eq_total`. |
| Are all G3 registers implemented on HiOne-16T-G3 firmware? | Read grouped ranges and compare null/zero/nonzero behavior. |
| Are battery module-level values available locally? | Check whether battery endpoints/API expose per-module data; scan for additional register blocks beyond public map. |
| Are HiBox-specific backup states exposed through API or Modbus? | Compare EPS API endpoints and backup registers `81`-`94`. |

---

## 14. Suggested raw Modbus capture format

For improving the mapping, make your app export a raw diagnostic bundle:

```json
{
  "device": {
    "host": "192.168.1.123",
    "port": 502,
    "unit_id": 1,
    "address_offset": 0,
    "word_order": "big",
    "byte_order": "big"
  },
  "timestamp": "2026-06-18T12:00:00+02:00",
  "known_state": "PV surplus, battery charging, grid export",
  "api_snapshot": {
    "pv_power": null,
    "grid_power": null,
    "load_power": null,
    "battery_power": null,
    "battery_soc": null
  },
  "registers": {
    "0-130": [],
    "201-243": [],
    "1021-1095": [],
    "2000-2135": [],
    "3200-3224": []
  }
}
```

This makes it easy to correlate unknown registers later.

---

## 15. Source list

These are the main sources used while preparing this report.

1. Hoymiles official HiOne page — `https://www.hoymiles.com/nl/hione.html`
2. Hoymiles official HiBox-63T-G3 page — `https://www.hoymiles.com/nl/hibox-63t-g3.html`
3. Hoymiles official DTS-G3 page — `https://www.hoymiles.com/nl/dts-g3.html`
4. Hoymiles HiOne solution datasheet PDF hosted by Shinetech — `https://shinetech-bg.com/wp-content/uploads/2025/05/Hoymiles_HiOne-SolutionDatasheet_shinetech.pdf`
5. Hoymiles official FAQ search result for DTU cloud ports — ports 10081, 10017, 80, 443.
6. Technical Note: Modbus implementation using 3Gen DTU-Pro V1.2 — public PDF hosted by mikrocontroller.net.
7. `Philra94/hoymiles-cloud` — Home Assistant cloud API integration.
8. `isjo-org/ha-hoymiles-modbus` — Home Assistant Modbus integration generated from `Technical Note - Energy Storage MODBUS Protocol Map V1.5`.
9. `wil-lem/ha-hoymiles-modbus-tcp` — Home Assistant Modbus TCP integration for Hoymiles DTU.
10. `wasilukm/hoymiles_modbus` — Python Hoymiles Modbus TCP client documentation.
11. `suaveolent/hoymiles-wifi` — local Hoymiles protobuf/TCP library.
12. Homey community Hoymiles DTU integration page — raw TCP port 10081/proprietary HM frame/protobuf behavior.
13. S-Miles Enduser app listings — station/module monitoring, energy stats, alarms.

---

## 16. Practical next step

The fastest next step is to perform a simultaneous capture:

1. Poll Cloud API values.
2. Poll Modbus TCP port 502 registers.
3. Optionally attempt port 10081 with a known proprietary Hoymiles client.
4. Save everything with one timestamp and known physical state.

Start with these registers:

```text
0, 19, 21,
26-38,
45-50,
62-76,
81-94,
112-115,
1021-1029,
1046-1094,
2000, 2022, 2024, 2026, 2028, 2030, 2040, 2048, 2056, 2064, 2066, 2068, 2070,
2100, 2111, 2112, 2113, 2114, 2115, 2120, 2124, 2132, 2133, 2134
```

That register set should be enough to confirm the majority of the Homey/Home Assistant entities for your HiOne stack.
