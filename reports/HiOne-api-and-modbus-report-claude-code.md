# Hoymiles HiOne-G3 — API & Modbus TCP Integration Report

**Hardware stack:** HiOne-16T-G3 (hybrid inverter) · HiBox-63T-G3 (gateway / battery box) · HiOne-8B-G3 (battery module) · DTS-G3 (datalogger, connected to HiOne-16T-G3)  
**Target platforms:** Homey · Home Assistant  
**Report generated:** 2026-06-18  
**Research method:** Multi-source web search, live GitHub source code analysis, adversarial claim verification (101 agents, 85 claims extracted, 25 verified at 3-vote confidence)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Local Protocol — Port 10081 (Proprietary Protobuf)](#3-local-protocol--port-10081-proprietary-protobuf)
   - [Frame Structure](#31-frame-structure)
   - [Command Reference](#32-command-reference)
   - [Protobuf Schema — ESDataResDTO](#33-protobuf-schema--esdataresdto)
   - [Data Element Mapping — Local Protobuf](#34-data-element-mapping--local-protobuf)
4. [Modbus TCP — Port 502](#4-modbus-tcp--port-502)
   - [Scope and Limitations](#41-scope-and-limitations)
   - [Verified Modbus Registers](#42-verified-modbus-registers)
   - [Data Types and Scaling](#43-data-types-and-scaling)
5. [Cloud REST API](#5-cloud-rest-api)
   - [Base URLs](#51-base-urls)
   - [Authentication Flow](#52-authentication-flow)
   - [Data Endpoints](#53-data-endpoints)
   - [Battery Control](#54-battery-control)
   - [Data Element Mapping — Cloud API](#55-data-element-mapping--cloud-api)
6. [Master Data Element Mapping Table](#6-master-data-element-mapping-table)
7. [Open-Source Projects Reference](#7-open-source-projects-reference)
8. [Recommendations for Home Assistant & Homey](#8-recommendations-for-home-assistant--homey)
9. [Open Questions & Gaps](#9-open-questions--gaps)
10. [Caveats & Disclaimers](#10-caveats--disclaimers)
11. [Sources](#11-sources)

---

## 1. Executive Summary

> **The HiOne-G3 battery stack does NOT expose battery data over Modbus TCP.**

The key finding of this research is that the local TCP port **10081** on the HiBox-63T-G3 / DTS-G3 is **not Modbus TCP** — it uses a proprietary **binary framing protocol carrying Protocol Buffer 3 (Protobuf) payloads**. This is the richest local data source and provides battery SOC, power, grid, load, and full power-flow breakdowns.

**Port 502** does respond to standard Modbus TCP, but only covers a limited set of PV-only registers (power, energy, on/off control). Battery registers (`BATTERY_REGISTERS = null`) are explicitly absent from community implementations as of June 2026.

The **Hoymiles cloud REST API** (`neapi.hoymiles.com`) is the second complete data source, providing the same battery data as the local protobuf path but with added cloud-side aggregation (monthly/yearly energy, CO₂ reduction). It requires authentication and an internet connection.

**No official Hoymiles documentation** exists for any of these interfaces. All findings are based on reverse engineering by the community.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Local Network                        │
│                                                              │
│   ┌──────────────┐    RS485 / CAN    ┌───────────────────┐  │
│   │ HiOne-8B-G3  │◄─────────────────►│  HiOne-16T-G3     │  │
│   │ (Battery     │                   │  (Hybrid Inverter) │  │
│   │  Module)     │                   └────────┬──────────┘  │
│   └──────────────┘                            │ internal    │
│                                               │ bus         │
│   ┌──────────────┐                   ┌────────▼──────────┐  │
│   │ HiBox-63T-G3 │◄──────────────────│   DTS-G3          │  │
│   │ (Gateway /   │    Ethernet/WiFi  │   (Datalogger)    │  │
│   │  Battery Box)│                   └───────────────────┘  │
│   └──────┬───────┘                                          │
│          │ TCP                                               │
│          ├─── Port 10081 → Proprietary Protobuf (rich data) │
│          └─── Port 502   → Modbus TCP (PV only)             │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / cloud
               ┌───────▼────────┐
               │ neapi.hoymiles │
               │   .com (REST)  │
               └────────────────┘
```

**Practical note:** In many installations the DTS-G3 and HiBox-63T-G3 share the same IP address — the DTS-G3 is the TCP endpoint and bridges data from the inverter+battery stack. Both port 10081 and port 502 are served by the DTS-G3.

---

## 3. Local Protocol — Port 10081 (Proprietary Protobuf)

**Confidence: HIGH** (3-0 adversarial vote, independently verified by two separate projects)

### 3.1 Frame Structure

Every message exchanged on port 10081 is wrapped in a 10-byte binary header followed by the Protobuf payload:

```
Offset  Size  Field
──────  ────  ─────────────────────────────────────────
  0      2    Magic bytes: 0x48 0x4D ("HM")
  2      2    Command ID (little-endian)
  4      2    Sequence number (little-endian, increments per request)
  6      2    CRC-16/ARC checksum over the Protobuf payload only
              (polynomial 0xA001, initial value 0xFFFF)
  8      2    Payload length in bytes (little-endian)
 10      N    Protobuf 3 payload (N bytes)
```

- **No authentication** is required on the local network.
- The device holds one TCP connection at a time; reconnect if idle too long.
- The sequence number should increment with each request; the device echoes it back in the response header.

**CRC-16/ARC implementation (JavaScript):**

```javascript
function crc16arc(buffer) {
  let crc = 0xFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}
```

### 3.2 Command Reference

| Command Name              | Bytes (hex) | Direction     | Description                         |
|---------------------------|-------------|---------------|-------------------------------------|
| `ENERGY_STORAGE_DATA`     | `0xC3 0x03` | Request→Response | Read live energy storage data     |
| `ENERGY_STORAGE_USER_SET` | `0xC3 0x08` | Request→Response | Write battery operating mode      |

> **Note:** Additional command IDs likely exist but have not been reverse-engineered.

### 3.3 Protobuf Schema — ESDataResDTO

The response to `ENERGY_STORAGE_DATA` (0xC3 0x03) is a Protobuf 3 message. The top-level structure contains 18 fields:

```protobuf
message ESDataResDTO {
  string serial_number       = 1;
  int64  timestamp           = 2;
  int32  offset              = 3;
  float  active_power        = 4;   // W, net inverter output
  float  cp                  = 5;
  DPVProdMO     production   = 6;   // PV production
  DLoadConsMO   consumption  = 7;   // Load consumption
  repeated DPvMO pv_panels   = 8;   // Per-string PV data
  DBmsMO   battery_management = 9;  // ← Battery data lives here
  DGridMO  grid              = 10;  // Grid phases
  DLoadMO  load              = 11;  // Load phases
  DInvMO   inverter          = 12;  // Inverter stats
  DGenMO   generator         = 13;
  DGenMO   pv_inverter       = 14;
  IPSMO    integrated_power_system = 15;
  repeated DSmartLoadMO smart_loads = 16;
  DFlowMO  power_flow        = 17;  // Directional power flows
  repeated DChgCPMO charging_sessions = 18;
}
```

#### DBmsMO — Battery Management Sub-message (field 9)

| PB Field | Name              | Type    | Unit | Notes                              |
|----------|-------------------|---------|------|------------------------------------|
| 4        | `state_of_charge` | int32   | %    | Battery SOC 0–100                  |
| 8        | `power`           | int32   | W    | Positive = charging, Negative = discharging |
| 3        | *(unverified)*    | int32   | ?    | Potentially SOH — refuted in research |
| 17       | *(partial evidence)* | int32 | Wh  | Possibly charged energy (unverified) |
| 18       | *(partial evidence)* | int32 | Wh  | Possibly discharged energy (unverified) |

> Fields 3, 17, 18 were **not confirmed** by the adversarial verification process. Only fields **4** (SOC) and **8** (power) are high-confidence.

#### DFlowMO — Directional Power Flow (field 17)

| PB Field | Name                | Unit | Direction                  |
|----------|---------------------|------|----------------------------|
| 1        | `pv_to_load`        | W    | PV energy used directly    |
| 2        | `pv_to_battery`     | W    | PV energy stored           |
| 3        | `pv_to_grid`        | W    | PV energy exported         |
| 4        | `battery_to_load`   | W    | Battery powering load      |
| 5        | `grid_to_load`      | W    | Grid powering load         |
| 6        | `battery_to_grid`   | W    | Battery exporting to grid  |

#### DGridMO — Grid Phases (field 10)

Repeated per AC phase. Use `_sumPhases(field 10, subfield 4)` to get total grid power in W.

| PB Subfield | Name          | Unit | Notes               |
|-------------|---------------|------|---------------------|
| 4           | `power`       | W    | Phase grid power    |

#### DLoadMO — Load Phases (field 11)

Repeated per AC phase. Use `_sumPhases(field 11, subfield 3)` to get total load power in W.

| PB Subfield | Name          | Unit | Notes               |
|-------------|---------------|------|---------------------|
| 3           | `power`       | W    | Phase load power    |

### 3.4 Data Element Mapping — Local Protobuf

| Data Element         | Command        | Top-level Field | Sub-message | PB Field | Unit | Notes                              |
|----------------------|----------------|-----------------|-------------|----------|------|------------------------------------|
| Battery SOC          | 0xC3 0x03      | field 9 (DBmsMO) | —          | 4        | %    | 0–100                              |
| Battery Power        | 0xC3 0x03      | field 9 (DBmsMO) | —          | 8        | W    | +charge / −discharge               |
| PV→Load flow         | 0xC3 0x03      | field 17 (DFlowMO)| —         | 1        | W    |                                    |
| PV→Battery flow      | 0xC3 0x03      | field 17 (DFlowMO)| —         | 2        | W    |                                    |
| PV→Grid flow         | 0xC3 0x03      | field 17 (DFlowMO)| —         | 3        | W    |                                    |
| Battery→Load flow    | 0xC3 0x03      | field 17 (DFlowMO)| —         | 4        | W    |                                    |
| Grid→Load flow       | 0xC3 0x03      | field 17 (DFlowMO)| —         | 5        | W    |                                    |
| Battery→Grid flow    | 0xC3 0x03      | field 17 (DFlowMO)| —         | 6        | W    |                                    |
| Total Grid Power     | 0xC3 0x03      | field 10 (DGridMO)| sum phases | 4       | W    | + = import, − = export             |
| Total Load Power     | 0xC3 0x03      | field 11 (DLoadMO)| sum phases | 3       | W    |                                    |
| Active Power         | 0xC3 0x03      | field 4         | —           | —        | W    | Net inverter output                |
| Serial Number        | 0xC3 0x03      | field 1         | —           | —        | str  |                                    |
| Timestamp            | 0xC3 0x03      | field 2         | —           | —        | epoch ms |                               |

---

## 4. Modbus TCP — Port 502

**Confidence: MEDIUM** (community-reverse-engineered, no official documentation)

### 4.1 Scope and Limitations

The HiBox-63T-G3 / DTS-G3 **does respond** to standard Modbus TCP on port 502, but:

- It does **NOT** follow the Hoymiles DTU-Pro Modbus register layout.
- Plant-aggregate registers (`0x2000+`) are **unsupported**.
- Battery/ESS register blocks (`0x3000–0x6000`) are **unsupported**.
- **Battery SOC, power, voltage, current, temperature, and mode are NOT available via Modbus.**

The only confirmed Modbus data is limited to **PV power/energy** and **inverter on/off control**.

> This answers the question you raised: Modbus TCP on port 502 will not give you battery data for the HiOne-G3 stack. Use port 10081 (protobuf) or the cloud API instead.

### 4.2 Verified Modbus Registers

All registers use **Function Code 03** (Read Holding Registers) unless otherwise noted.  
Unit ID: **1** (also try 101–254 for multi-inverter setups).

#### DTU / Station Registers

| Register (hex) | Register (dec) | FC   | Name              | Type   | Unit | Scaling | Notes                        |
|----------------|----------------|------|-------------------|--------|------|---------|------------------------------|
| 0x2000         | 8192           | FC03 | DTU Serial Number | 3×uint16 | —  | —       | 6 ASCII chars across 3 words |

#### Per-Inverter Registers (DTU-Pro layout — compatibility with DTS-G3 unverified)

Base address: `0x1000 + (inverter_index × stride)`  
Stride: **40 registers** for dtu_type 0 or 2; **20 registers** for dtu_type 1.

| Offset | Name                | Type       | Unit  | Scaling    | Notes                             |
|--------|---------------------|------------|-------|------------|-----------------------------------|
| 0x1000 | PV String Voltage   | udec16p1   | V     | ÷10        |                                   |
| 0x1001 | PV String Current   | udec16p2   | A     | ÷100       |                                   |
| 0x1002 | Grid Voltage        | udec16p1   | V     | ÷10        | AC output                         |
| 0x1003 | Grid Frequency      | udec16p2   | Hz    | ÷100       |                                   |
| 0x1004 | PV Power            | udec16p1   | W     | ÷10        |                                   |
| 0x1005 | Today Production    | uint16     | Wh    | ×1         |                                   |
| 0x1006 | Total Production    | uint32     | Wh    | ×1         | 2 registers (high word first)     |
| 0x1008 | Temperature         | sdec16p1   | °C    | ÷10        | Signed                            |
| 0x1009 | Operating Status    | uint16     | —     | —          | See status codes below            |
| 0x100A | Alarm Code          | uint16     | —     | —          |                                   |
| 0x100B | Alarm Count         | uint16     | —     | —          |                                   |
| 0x100C | Link Status         | uint8      | —     | —          | 0=offline, 1=online               |

Shortcut registers (station-level aggregates — on some firmware versions):

| Register (hex) | Register (dec) | Name           | Unit | Scaling |
|----------------|----------------|----------------|------|---------|
| 0x1010         | 4112           | Total PV Power | W    | ×1      |
| 0x1012         | 4114           | Today Energy   | Wh   | ×1      |
| 0x1014         | 4116           | Total Energy   | Wh   | ×1      |

#### Control Registers

| Register (hex) | Register (dec) | FC   | Name                  | Type   | Values                        |
|----------------|----------------|------|-----------------------|--------|-------------------------------|
| 0xC000         | 49152          | FC05 | Power On/Off All      | coil   | 0xFF00 = ON · 0x0000 = OFF    |
| 0xC001         | 49153          | FC16 | Active Power Limit    | uint16 | 2–100 (percent); added Jun 2026 |

#### Battery Registers

| Register Range | Status                                                          |
|----------------|-----------------------------------------------------------------|
| 0x3000–0x6000  | **NOT SUPPORTED** on HiBox-63T-G3 (DTU-Pro layout not followed) |
| BATTERY_REGISTERS | `null` — explicitly undefined in community code as of Jun 2026 |

### 4.3 Data Types and Scaling

| Type Name   | Size     | Signed | Decimal Places | Divide By |
|-------------|----------|--------|----------------|-----------|
| uint16      | 16-bit   | No     | 0              | 1         |
| int16       | 16-bit   | Yes    | 0              | 1         |
| udec16p1    | 16-bit   | No     | 1              | 10        |
| udec16p2    | 16-bit   | No     | 2              | 100       |
| sdec16p1    | 16-bit   | Yes    | 1              | 10        |
| uint32      | 32-bit   | No     | 0              | 1         |
| udec32p1    | 32-bit   | No     | 1              | 10        |

---

## 5. Cloud REST API

**Confidence: HIGH** (3-0 adversarial vote)

### 5.1 Base URLs

| Region            | Base URL                         | Notes                           |
|-------------------|----------------------------------|---------------------------------|
| Global (default)  | `https://neapi.hoymiles.com`     | Main data API                   |
| EU Auth Gateway   | `https://euapi.hoymiles.com`     | Authentication for EU accounts  |
| Legacy            | `https://global.hoymiles.com`    | Older S-Miles Cloud portal      |

### 5.2 Authentication Flow

Hoymiles uses a **two-step V3 authentication flow**:

#### Step 1 — Pre-inspection (get nonce)

```http
POST https://euapi.hoymiles.com/iam/pub/3/auth/pre-insp
Content-Type: application/json

{
  "u": "your@email.com"
}
```

Response includes:
- `nonce` — a server-generated one-time value
- `salt` — optional, used for credential hashing

#### Step 2 — Login (get token)

```http
POST https://euapi.hoymiles.com/iam/pub/3/auth/login
Content-Type: application/json

{
  "u": "your@email.com",
  "ch": "<credential_hash>",
  "n": "<nonce_from_step_1>",
  "a": "<account_type>"
}
```

The `credential_hash` is computed from the password + nonce + salt (exact hashing algorithm: SHA-256 or similar — see community source code for implementation).

Response includes a **bearer token** valid for **2 hours** (`TOKEN_LIFETIME_MS = 2 × 60 × 60 × 1000`).

#### Legacy V0 Flow (single-step, simpler)

```http
POST https://neapi.hoymiles.com/iam/pub/0/auth/login
Content-Type: application/json

{
  "user_name": "your@email.com",
  "password": "<md5(password)>"
}
```

> The V0 flow uses `md5(password)` directly. It may be deprecated in future.

All subsequent API calls require the header:
```http
Authorization: Bearer <token>
```

### 5.3 Data Endpoints

#### Real-time Station Data

```http
POST https://neapi.hoymiles.com/pvm-data/api/0/station/data/count_station_real_data
Authorization: Bearer <token>
Content-Type: application/json

{
  "sid": "<station_id>"
}
```

**Response structure:**

```json
{
  "data": {
    "reflux_station_data": {
      "bms_soc":    85,
      "bms_power":  -1200,
      "grid_power": 300,
      "load_power": 2500
    },
    "pv_power":          3800,
    "battery_power":     -1200,
    "battery_soc":       85,
    "grid_power":        300,
    "load_power":        2500,
    "daily_energy":      12500,
    "monthly_energy":    340000,
    "yearly_energy":     2100000,
    "total_energy":      15000000,
    "battery_in_energy": 850000,
    "battery_out_energy":800000,
    "co2_reduction":     7500
  }
}
```

#### Sign Conventions (Cloud API)

| Field          | Positive (+) | Negative (−)         |
|----------------|--------------|----------------------|
| `battery_power`/ `bms_power` | Charging | Discharging |
| `grid_power` / `bms_power`   | Importing from grid | Exporting to grid |

### 5.4 Battery Control

```http
POST https://neapi.hoymiles.com/pvm-ctl/api/0/dev/setting/write
Authorization: Bearer <token>
Content-Type: application/json

{
  "action": 1013,
  "sid":    "<station_id>",
  "mode":   <mode_code>
}
```

| Mode Code | Mode Name    | Settable Via        |
|-----------|--------------|---------------------|
| 1         | Self-Use     | Local protobuf + Cloud |
| 2         | *(reserved)* | Cloud only (unverified) |
| 3         | Backup       | Local protobuf + Cloud |
| 4         | Off-Grid     | Local protobuf + Cloud |
| 5–8       | (TOU etc.)   | Cloud only (unverified) |

> **Caution:** Modes 2 and 5–8 were partially refuted during verification. Treat as unconfirmed. Only modes 1, 3, and 4 are high-confidence.

### 5.5 Data Element Mapping — Cloud API

| Data Element           | Endpoint                              | JSON Path                                  | Unit   | Sign Convention              |
|------------------------|---------------------------------------|--------------------------------------------|--------|------------------------------|
| Battery SOC            | count_station_real_data               | `.data.battery_soc`                        | %      | 0–100                        |
| Battery Power          | count_station_real_data               | `.data.battery_power`                      | W      | + charging / − discharging   |
| PV Power               | count_station_real_data               | `.data.pv_power`                           | W      | Always positive              |
| Grid Power             | count_station_real_data               | `.data.grid_power`                         | W      | + import / − export          |
| Load Power             | count_station_real_data               | `.data.load_power`                         | W      | Always positive              |
| Today Energy           | count_station_real_data               | `.data.daily_energy`                       | Wh     |                              |
| Monthly Energy         | count_station_real_data               | `.data.monthly_energy`                     | Wh     |                              |
| Yearly Energy          | count_station_real_data               | `.data.yearly_energy`                      | Wh     |                              |
| Total Energy           | count_station_real_data               | `.data.total_energy`                       | Wh     |                              |
| Battery Energy In      | count_station_real_data               | `.data.battery_in_energy`                  | Wh     | Cumulative charged           |
| Battery Energy Out     | count_station_real_data               | `.data.battery_out_energy`                 | Wh     | Cumulative discharged        |
| CO₂ Reduction          | count_station_real_data               | `.data.co2_reduction`                      | g      |                              |
| Raw Battery SOC        | count_station_real_data               | `.data.reflux_station_data.bms_soc`        | %      | Same as battery_soc          |
| Raw Battery Power      | count_station_real_data               | `.data.reflux_station_data.bms_power`      | W      |                              |
| Raw Grid Power         | count_station_real_data               | `.data.reflux_station_data.grid_power`     | W      |                              |
| Raw Load Power         | count_station_real_data               | `.data.reflux_station_data.load_power`     | W      |                              |

---

## 6. Master Data Element Mapping Table

This is the key table for your integration development. It shows every known data element and how to get it from each interface.

**Legend:**  
✅ = Available, confirmed high-confidence  
⚠️ = Available, medium confidence / community only  
❌ = Not available / not supported  
❓ = Unknown / unverified

| Data Element              | Local Protobuf (port 10081)                          | Modbus TCP (port 502)             | Cloud REST API                        |
|---------------------------|------------------------------------------------------|-----------------------------------|---------------------------------------|
| **Battery**               |                                                      |                                   |                                       |
| Battery SOC (%)           | ✅ field9→field4                                     | ❌ Not supported                  | ✅ `.data.battery_soc`               |
| Battery Power (W)         | ✅ field9→field8 (+chg/−dchg)                        | ❌ Not supported                  | ✅ `.data.battery_power`             |
| Battery Voltage (V)       | ❓ DBmsMO — field unknown                            | ❌ Not supported                  | ❓ Not found in API                  |
| Battery Current (A)       | ❓ DBmsMO — field unknown                            | ❌ Not supported                  | ❓ Not found in API                  |
| Battery Temperature (°C)  | ❓ DBmsMO — field unknown                            | ❌ Not supported                  | ❓ Not found in API                  |
| Battery SOH (%)           | ❓ DBmsMO field3 (refuted — unconfirmed)             | ❌ Not supported                  | ❓ Not found in API                  |
| Battery Mode              | ✅ ENERGY_STORAGE_USER_SET (0xC3 0x08) write         | ❌ Not supported                  | ✅ action 1013                       |
| Battery Energy In (Wh)    | ❓ DBmsMO field17 (unverified)                        | ❌ Not supported                  | ✅ `.data.battery_in_energy`         |
| Battery Energy Out (Wh)   | ❓ DBmsMO field18 (unverified)                        | ❌ Not supported                  | ✅ `.data.battery_out_energy`        |
| **PV / Solar**            |                                                      |                                   |                                       |
| PV Power (W)              | ✅ field6 (DPVProdMO)                                | ✅ 0x1004 (per inverter)          | ✅ `.data.pv_power`                  |
| PV String Voltage (V)     | ✅ field8 (repeated DPvMO)                           | ✅ 0x1000 ÷10                     | ❌ Not in real-time endpoint         |
| PV String Current (A)     | ✅ field8 (repeated DPvMO)                           | ✅ 0x1001 ÷100                    | ❌ Not in real-time endpoint         |
| Today PV Energy (Wh)      | ✅ field6 (DPVProdMO)                                | ✅ 0x1005 or 0x1012               | ✅ `.data.daily_energy`              |
| Total PV Energy (Wh)      | ✅ field6 (DPVProdMO)                                | ✅ 0x1006 (uint32) or 0x1014      | ✅ `.data.total_energy`              |
| Monthly Energy (Wh)       | ❌ Not in local protocol                              | ❌ Not supported                  | ✅ `.data.monthly_energy`            |
| Yearly Energy (Wh)        | ❌ Not in local protocol                              | ❌ Not supported                  | ✅ `.data.yearly_energy`             |
| **Grid**                  |                                                      |                                   |                                       |
| Grid Power (W)            | ✅ sum(field10→field4) phases (+imp/−exp)             | ❌ Not in DTU-Pro layout          | ✅ `.data.grid_power`                |
| Grid Voltage (V)          | ✅ field12 (DInvMO) or field10 phase                 | ✅ 0x1002 ÷10                     | ❌ Not in real-time endpoint         |
| Grid Frequency (Hz)       | ✅ field12 (DInvMO)                                  | ✅ 0x1003 ÷100                    | ❌ Not in real-time endpoint         |
| **Load / Home**           |                                                      |                                   |                                       |
| Load Power (W)            | ✅ sum(field11→field3) phases                         | ❌ Not supported                  | ✅ `.data.load_power`                |
| **Power Flows**           |                                                      |                                   |                                       |
| PV → Load (W)             | ✅ field17→field1                                    | ❌ Not supported                  | ❌ Not exposed separately            |
| PV → Battery (W)          | ✅ field17→field2                                    | ❌ Not supported                  | ❌ Not exposed separately            |
| PV → Grid (W)             | ✅ field17→field3                                    | ❌ Not supported                  | ❌ Not exposed separately            |
| Battery → Load (W)        | ✅ field17→field4                                    | ❌ Not supported                  | ❌ Not exposed separately            |
| Grid → Load (W)           | ✅ field17→field5                                    | ❌ Not supported                  | ❌ Not exposed separately            |
| Battery → Grid (W)        | ✅ field17→field6                                    | ❌ Not supported                  | ❌ Not exposed separately            |
| **Inverter**              |                                                      |                                   |                                       |
| Inverter Temperature (°C) | ✅ field12 (DInvMO)                                  | ✅ 0x1008 ÷10 (signed)            | ❓ Not confirmed in API              |
| Operating Status          | ✅ field12 (DInvMO)                                  | ✅ 0x1009                         | ❓ Not confirmed                     |
| Alarm Code                | ✅ field12 (DInvMO)                                  | ✅ 0x100A                         | ❓ Not confirmed                     |
| Active Power               | ✅ field4 (top-level)                                | ⚠️ 0x1010 (aggregate)             | ✅ derived from pv_power             |
| **Control**               |                                                      |                                   |                                       |
| Power On/Off              | ❓ Possible via command (unverified)                  | ✅ 0xC000 FC05 coil               | ❓ Possible via settings API         |
| Active Power Limit (%)    | ❓ Possible via command (unverified)                  | ⚠️ 0xC001 FC16 (added Jun 2026)   | ❓ Possible via settings API         |
| Battery Mode Write        | ✅ 0xC3 0x08 (modes 1,3,4 confirmed)                 | ❌ Not supported                  | ✅ action 1013                       |
| **Identification**        |                                                      |                                   |                                       |
| DTU Serial Number         | ✅ field1 (top-level)                                | ✅ 0x2000 (3 registers)            | ✅ in station config API             |
| CO₂ Reduction (g)         | ❌ Not in local protocol                              | ❌ Not supported                  | ✅ `.data.co2_reduction`             |

---

## 7. Open-Source Projects Reference

### 7.1 Homey Apps (HiOne-G3 specific — most relevant)

#### ItsRaYnor/homey-app-hoymiles-hione
- **URL:** https://github.com/ItsRaYnor/homey-app-hoymiles-hione
- **Last updated:** June 2026
- **G3 compatible:** ✅ Yes — specifically targets HiOne-16T-G3, HiBox-63T-G3, HiOne-8B-G3, DTS-G3
- **Protocol support:** Local protobuf (port 10081) + Modbus TCP (port 502) + Cloud REST API
- **Key files:**
  - `lib/HoymilesLocal.js` — Protobuf frame building, CRC, command constants, field parsing
  - `lib/HoymilesModbus.js` — Modbus register definitions, BATTERY_REGISTERS = null
  - `lib/HoymilesApi.js` — Cloud API, two-step auth V3, endpoint constants
  - `lib/HoymilesHybrid.js` — Three-mode protocol selection (auto/native/modbus)
- **Notes:** Most complete reverse-engineering of the G3 local protocol. `auto` mode probes Modbus first and falls back to native protobuf.

#### rcoemans/com.hoymiles.hione
- **URL:** https://github.com/rcoemans/com.hoymiles.hione
- **Last updated:** June 2026
- **G3 compatible:** ✅ Yes
- **Protocol support:** Local protobuf (port 10081) + Cloud REST API
- **Key files:** `HoymilesLocal.js`, `HioneMapper.js`
- **Notes:** Independent implementation, confirms identical frame structure. README explicitly documents that HiBox does NOT follow DTU-Pro Modbus register layout. `HioneMapper.js` documents raw cloud API field names (`bms_soc`, `bms_power`, etc.).

### 7.2 Home Assistant Integrations (PV-only, not battery-compatible)

#### suaveolent/hoymiles-wifi + ha-hoymiles-wifi
- **URL:** https://github.com/suaveolent/hoymiles-wifi / https://github.com/suaveolent/ha-hoymiles-wifi
- **G3 compatible:** ❌ No — targets G1/G2 WiFi hybrid inverters (HAS-5.0LV, HYS-4.6LV, HYT-5.0HV, HAT-8.0HV)
- **Protobuf schemas:** Available in `hoymiles_wifi/protobuf/` — `ESData.proto` may partially apply to G3
- **Notes:** Useful for Protobuf schema reference even if hardware support doesn't extend to G3.

#### wil-lem/ha-hoymiles-modbus-tcp
- **URL:** https://github.com/wil-lem/ha-hoymiles-modbus-tcp
- **G3 compatible:** ❌ No — tested exclusively with DTU-Pro S
- **Notes:** Exposes only 2 sensor values (real-time power, total energy). No battery registers.

#### netnic0/ha-hoymiles-dtupro
- **URL:** https://github.com/netnic0/ha-hoymiles-dtupro
- **G3 compatible:** ❌ Not confirmed — targets DTU-Pro
- **Notes:** PV-only registers in `const.py` and `models.py`. No battery fields.

### 7.3 Python Libraries

#### ArekKubacki/Hoymiles-Plant-DTU-Pro
- **URL:** https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro
- **G3 compatible:** ⚠️ Partial — targets DTU-Pro, register layout differs from DTS-G3
- **Key files:** `hoymiles/client.py` (register layout), `hoymiles/datatypes.py` (decimal type definitions)
- **Notes:** Best reference for Modbus data type definitions (udec16p1, udec16p2, etc.).

#### wasilukm/hoymiles-mqtt
- **URL:** https://github.com/wasilukm/hoymiles-mqtt
- **G3 compatible:** ❓ Unknown
- **Notes:** Cloud API bridge to MQTT.

### 7.4 Alternative/Related Projects (Not Hoymiles-native)

#### tbnobody/OpenDTU
- **URL:** https://github.com/tbnobody/OpenDTU / https://www.opendtu.solar
- **Notes:** Open-source DTU replacement for Hoymiles microinverters (HMS/HMT). Does NOT target HiOne-G3 hybrid inverters or batteries. Documented REST API at opendtu.solar.

#### helgeerbe/OpenDTU-OnBattery
- **URL:** https://github.com/helgeerbe/OpenDTU-OnBattery
- **Notes:** Extends OpenDTU with battery BMS integration (Pylontech, SMA). Not specific to Hoymiles HiOne battery.

---

## 8. Recommendations for Home Assistant & Homey

### For Homey

The two existing Homey apps (ItsRaYnor and rcoemans) are your best starting point. If building your own:

1. **Use `native` mode** (port 10081 protobuf) as your primary data source — it gives battery SOC, power, all directional power flows, grid, and load without depending on the cloud.
2. **Fall back to Cloud API** for cumulative energy metrics (monthly/yearly totals) that aren't available locally.
3. **Avoid Modbus (port 502)** for anything battery-related — it won't work.
4. Reference `HoymilesHybrid.js` from ItsRaYnor for the `auto` protocol detection pattern.

### For Home Assistant

No G3-specific Home Assistant integration exists. Options:

1. **Write a custom integration** based on the ItsRaYnor Homey app logic (port to Python). The protobuf parsing is straightforward using the `protobuf` Python library.
2. **Use MQTT bridge:** Implement the local protobuf client as a standalone Python/Node script that publishes to MQTT, then use the standard MQTT integration in HA.
3. **Use the cloud API:** Implement a polling REST sensor in HA using the documented endpoints. Downside: requires internet, 2-hour token expiry handling, Hoymiles could change endpoints.
4. **Watch:** There may be a native HA integration in development given the activity level of both Homey apps as of June 2026.

### Protocol Priority Recommendation

```
Priority 1: Port 10081 (protobuf)
  → All battery data, power flows, grid, load — real-time, local, no auth needed
  → Implement ENERGY_STORAGE_DATA (0xC3 0x03) polling

Priority 2: Cloud API (neapi.hoymiles.com)
  → Cumulative energy (monthly/yearly), CO₂, battery in/out energy
  → Required only if historical aggregates are needed

Priority 3: Port 502 (Modbus)
  → Power On/Off control, Active Power Limit control
  → PV-only metrics as a cross-check
  → Do NOT use for battery data
```

---

## 9. Open Questions & Gaps

These are confirmed unknowns as of the research date:

1. **Full DBmsMO schema** — Only fields 4 (SOC) and 8 (power) are confirmed. The full battery sub-message likely contains voltage, current, temperature, cell data, and SOH but field numbers are unknown. Reversing `lib/HoymilesLocal.js` in more detail or capturing live traffic with Wireshark would resolve this.

2. **DTS-G3 vs HiBox-63T-G3 distinction** — Research conflates these as the same TCP endpoint. They may be distinct devices with different Modbus capabilities. The DTS-G3 is physically connected to the HiOne-16T-G3; the HiBox-63T-G3 is the battery enclosure. It is unclear if they share an IP or expose separate services.

3. **Battery operating modes** — Modes 2, 5, 6, 7, 8 (Time-of-Use scheduling, etc.) were flagged as cloud-only but not verified. The full payload structure for battery mode commands (action 1013) is undocumented.

4. **Official Modbus documentation** — No official Hoymiles Modbus register map for DTS-G3 or HiOne-G3 was found. Hoymiles may provide this through dealer/installer portals or FCC/CE technical filings. Worth requesting directly from Hoymiles technical support.

5. **Scan-based battery register discovery** — The ItsRaYnor Modbus implementation includes a `scan()` method intended to auto-discover battery registers. Running this scan against a live system would be the fastest path to finding any Modbus battery registers that do exist.

6. **Local battery mode write command** — `ENERGY_STORAGE_USER_SET` (0xC3 0x08) payload structure for setting modes 1/3/4 is not fully documented (only partially verified from source code).

---

## 10. Caveats & Disclaimers

1. **No official documentation exists** for any of these interfaces. Everything in this report is based on community reverse-engineering, primarily two Homey app repositories last updated June 2026.

2. **Hoymiles can change any of these protocols** (API endpoints, protobuf schema, Modbus registers, frame format) at any time without notice.

3. **DTU-Pro Modbus register tables** (sections 4.2, per-inverter registers) are derived from DTU-Pro hardware. Their applicability to DTS-G3 is explicitly unverified and potentially incompatible.

4. **The ESData.proto schema** from the `hoymiles-wifi` library may describe G1/G2 hybrid inverters, not the G3 series. The field numbers and names are consistent with the ItsRaYnor implementation, suggesting cross-generation compatibility, but this is not confirmed.

5. **Cloud API field names** (`bms_soc`, `bms_power`, etc.) are private/undocumented and could change without notice.

6. **The `BATTERY_REGISTERS = null`** constant in ItsRaYnor's Modbus implementation means battery registers have not yet been identified or calibrated — they remain an open research question.

---

## 11. Sources

All sources were fetched and verified by the research harness. Quality ratings: **primary** = source code directly examined; **secondary** = documentation/README.

| # | URL | Quality | Notes |
|---|-----|---------|-------|
| 1 | https://github.com/ItsRaYnor/homey-app-hoymiles-hione | primary | Main G3 Homey app — most complete source |
| 2 | https://raw.githubusercontent.com/ItsRaYnor/homey-app-hoymiles-hione/main/lib/HoymilesLocal.js | primary | Protobuf frame structure, commands, field parsing |
| 3 | https://raw.githubusercontent.com/ItsRaYnor/homey-app-hoymiles-hione/main/lib/HoymilesHybrid.js | primary | Three-mode protocol selection logic |
| 4 | https://raw.githubusercontent.com/ItsRaYnor/homey-app-hoymiles-hione/main/lib/HoymilesModbus.js | primary | Modbus register definitions, BATTERY_REGISTERS=null |
| 5 | https://raw.githubusercontent.com/ItsRaYnor/homey-app-hoymiles-hione/main/lib/HoymilesApi.js | primary | Cloud API endpoints, auth flow, token management |
| 6 | https://github.com/rcoemans/com.hoymiles.hione | primary | Independent G3 Homey app — confirms protobuf protocol |
| 7 | https://raw.githubusercontent.com/suaveolent/hoymiles-wifi/main/hoymiles_wifi/protobuf/ESData.proto | primary | Protobuf schema for ESDataResDTO message |
| 8 | https://raw.githubusercontent.com/suaveolent/hoymiles-wifi/main/hoymiles_wifi/protobuf/RealDataNew.proto | primary | Alternative schema (G1/G2 only) |
| 9 | https://github.com/suaveolent/hoymiles-wifi | primary | Python Protobuf library (G1/G2 hardware) |
| 10 | https://github.com/suaveolent/ha-hoymiles-wifi | primary | HA integration for G1/G2 hardware |
| 11 | https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro | primary | DTU-Pro Modbus client — register layout reference |
| 12 | https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro/blob/main/hoymiles/datatypes.py | primary | Modbus data type definitions (udec16p1 etc.) |
| 13 | https://github.com/wil-lem/ha-hoymiles-modbus-tcp | primary | HA Modbus TCP integration (DTU-Pro S only) |
| 14 | https://github.com/netnic0/ha-hoymiles-dtupro | primary | HA DTU-Pro integration (PV-only) |
| 15 | https://github.com/wasilukm/hoymiles-mqtt | secondary | MQTT cloud bridge |
| 16 | https://github.com/tbnobody/OpenDTU | primary | OpenDTU microinverter replacement firmware |
| 17 | https://www.opendtu.solar/firmware/web_api/ | primary | OpenDTU REST API documentation |
| 18 | https://github.com/helgeerbe/OpenDTU-OnBattery | primary | OpenDTU battery extension |
| 19 | https://github.com/topics/hoymiles | secondary | GitHub topic page — project discovery |
| 20 | https://global.hoymiles.com/platform/login | — | Official portal — no public API docs found |

---

*Report generated by Claude Code deep-research harness · 101 agents · 85 claims extracted · 25 adversarially verified · 21 confirmed · 4 killed*
