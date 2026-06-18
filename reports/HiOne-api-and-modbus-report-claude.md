# Hoymiles HiOne Stack — API & Modbus TCP Comprehensive Report

> **Generated:** July 2025
> **Target Hardware:** HiOne-16T-G3 (hybrid inverter), HiBox-63T-G3 (gateway), HiOne-8B-G3 (battery), DTS-G3 (data transfer stick)
> **Author:** AI-assisted research compilation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Communication Protocols Overview](#3-communication-protocols-overview)
4. [Hoymiles S-Miles Cloud API (REST)](#4-hoymiles-s-miles-cloud-api-rest)
5. [Modbus TCP via DTS-G3 (Port 502)](#5-modbus-tcp-via-dts-g3-port-502)
6. [Local Protobuf Communication (Port 10081)](#6-local-protobuf-communication-port-10081)
7. [Hybrid Inverter Modbus Register Map (Official — Newer Firmware)](#7-hybrid-inverter-modbus-register-map-official--newer-firmware)
8. [Complete Data Element Mapping Table](#8-complete-data-element-mapping-table)
9. [Battery Mode Reference](#9-battery-mode-reference)
10. [Community Projects & GitHub Repositories](#10-community-projects--github-repositories)
11. [Known Issues & Gotchas](#11-known-issues--gotchas)
12. [Recommendations for HiOne Stack Integration](#12-recommendations-for-hione-stack-integration)
13. [Sources & References](#13-sources--references)

---

## 1. Executive Summary

The Hoymiles HiOne stack is a residential PV + ESS (Energy Storage System) platform consisting of a hybrid inverter, battery modules, a gateway, and a data transfer stick. There are **three main communication channels** for accessing data:

| Channel | Protocol | Port | Scope | Latency | Requires Internet |
|---------|----------|------|-------|---------|-------------------|
| **S-Miles Cloud API** | HTTPS REST (JSON) | 443 | Full ESS data (PV, battery, grid, load, modes) | 30-120s | Yes |
| **Modbus TCP** (DTS-G3) | Modbus TCP | 502 | PV/microinverter data only (DTU-Pro register map) | 1-5s | No |
| **Local Protobuf** (DTS-G3) | TCP + Protocol Buffers | 10081 | Full ESS data (PV, battery, grid, load, modes) | 1-5s | No |

**Key finding:** Modbus TCP on the DTS-G3 stick only exposes the **DTU-Pro microinverter register map** (PV power, energy, voltage, current, temperature, alarms). It does **NOT** expose ESS-specific data (battery SoC, battery power, grid power, load power, working mode) — those ESS registers (0x3000–0x6000) consistently time out on the HiBox/HiOne stack.

The **only reliable local** source of full ESS data is the **protobuf interface** on port 10081, as used by the `hoymiles-wifi` library. The cloud API provides the same data but with higher latency and internet dependency.

For **larger Hoymiles hybrid inverters** (HAS, HYS, HAT, HYT series) with a direct Ethernet/WLAN connection (not through a DTS stick), Hoymiles has published an official Modbus register map for hybrid inverter running data (see Section 7).

---

## 2. System Architecture

```
                          ┌─────────────────────┐
                          │   S-Miles Cloud      │
                          │  neapi.hoymiles.com  │
                          │  euapi.hoymiles.com  │
                          └──────────┬──────────┘
                                     │ HTTPS (443)
                                     │
┌──────────────┐    RS485    ┌──────┴──────────┐    TCP/IP    ┌──────────────┐
│  HiOne-16T   │◄──────────►│  DTS-G3 Stick    │◄───────────►│  Home Network│
│  (Inverter)  │            │  (WiFi/LAN)      │             │  Router      │
│              │            │                  │             └──────┬───────┘
│  ┌────────┐  │            │  Port 502:       │                    │
│  │HiOne-8B│  │            │    Modbus TCP    │            ┌───────┴───────┐
│  │(Battery)│ │            │  Port 10081:     │            │  Homey / HA   │
│  └────────┘  │            │    Protobuf      │            │  (Client)     │
│              │            └──────────────────┘            └───────────────┘
│  ┌────────┐  │
│  │HiBox-63│  │
│  │(Gateway)│ │
│  └────────┘  │
└──────────────┘
```

**DTS-G3** is the data transfer stick that bridges between the inverter's RS485 bus and the local network (WiFi or LAN). It serves as both a Modbus TCP slave and a protobuf server.

---

## 3. Communication Protocols Overview

### 3.1 Protocol Comparison

| Feature | Cloud API | Modbus TCP (502) | Protobuf (10081) |
|---------|-----------|------------------|------------------|
| **PV Power** | Yes | Yes (confirmed) | Yes |
| **Daily Energy** | Yes | Yes (confirmed) | Yes |
| **Total Energy** | Yes | Yes (confirmed) | Yes |
| **Battery SoC** | Yes | No (ESS timeout) | Yes |
| **Battery Power** | Yes | No (ESS timeout) | Yes |
| **Grid Power** | Yes | No (ESS timeout) | Yes |
| **Load Power** | Yes | No (ESS timeout) | Yes |
| **Battery Mode** | Yes (R/W) | No (ESS timeout) | Yes (R/W) |
| **PV Voltage** | No | Yes (per port) | Yes |
| **PV Current** | No | Yes (per port) | Yes |
| **Grid Voltage** | No | Yes (per port) | Yes |
| **Grid Frequency** | No | Yes (per port) | Yes |
| **Temperature** | No | Yes (per port) | Yes |
| **Alarm Codes** | No | Yes (per port) | Yes |
| **Reserve SoC** | Yes (R/W) | No | Yes (R/W) |
| **Max SoC** | Yes (R/W) | No | Yes (R/W) |
| **Requires Internet** | Yes | No | No |
| **Update Frequency** | 30-120s | 1-5s | 1-5s |
| **Authentication** | Argon2id/MD5 | None | None |

### 3.2 Protocol Selection Strategy

For the Homey HiOne app, the recommended strategy is a **hybrid approach**:

1. **Primary:** Local protobuf (port 10081) for real-time ESS data
2. **Secondary:** Modbus TCP (port 502) for detailed PV port data
3. **Fallback:** Cloud API when local protocols fail or for mode changes
4. **Merge:** Cloud data "tops up" any fields missing from local sources

---

## 4. Hoymiles S-Miles Cloud API (REST)

### 4.1 Base URLs

| Profile | Base URL | Purpose |
|---------|----------|---------|
| Web / API | `https://neapi.hoymiles.com` | Primary API endpoint (all regions) |
| S-Miles Home (EU consumer) | `https://euapi.hoymiles.com` | EU consumer gateway |
| Global (alternative) | `https://global.hoymiles.com` | Alternative endpoint |

### 4.2 Authentication

The S-Miles Cloud uses a **multi-mode authentication** system:

| Mode | Path | Method | Notes |
|------|------|--------|-------|
| **V3 Web** | `/iam/pub/3/auth/pre-insp` → `/iam/pub/3/auth/login` | Argon2id salted | User-Agent: `HomeAssistant-HoymilesCloud` |
| **V3 Installer** | `/iam/pub/3/auth/pre-insp` → `/iam/pub/3/auth/login` | Argon2id salted | User-Agent: `S-Miles Installer/3.7.1` |
| **V3 Home** | `/iam/pub/3/auth/pre-insp` → `/iam/pub/3/auth/login` | Argon2id salted | User-Agent: `sma/ad/2.10.0/159/0`, uses euapi |
| **Legacy V0** | `/iam/pub/0/auth/login` | MD5(password) | Fallback for older accounts |

**Argon2id Parameters** (from Philra94 reference):
- `time_cost=3`, `memory_cost=32768`, `parallelism=1`, `hash_len=32`
- Salt: decoded as hex first, then base64, then UTF-8
- Output: `argon2id_output.hex()`

**Token:** Bearer token returned in the login response, valid for ~2 hours.

### 4.3 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/iam/api/1/user/me` | POST | Current user info |
| `/pvm/api/0/station/select_by_page` | POST | List stations |
| `/pvm/api/0/dev/select_by_page` | POST | List devices under a station |
| `/pvm-data/api/0/station/data/count_station_real_data` | POST | **Real-time telemetry** (PV, battery, grid, load, mode, energy) |
| `/pvm-data/api/0/station/data_fd/stat_g_a` | POST | Energy totals (daily, monthly, yearly) |
| `/pvm-data/api/0/station/data/eps_profit` | POST | EPS profit data |
| `/pvm-ctl/api/0/dev/setting/read` | POST | Read battery settings (async job) |
| `/pvm-ctl/api/0/dev/setting/write` | POST | Write battery settings / mode (async job) |
| `/pvm-ctl/api/0/dev/setting/job_status` | POST | Poll async job status |
| `/pvm-ctl/api/0/dev/relay/ctrl` | POST | Control relay output |

### 4.4 Real-Time Data Response Structure

The primary real-time data endpoint returns:

```json
{
  "status": "0",
  "message": "success",
  "data": {
    "reflux_station_data": {
      "pv_power": "3500",           // PV power in W (string)
      "grid_power": "-1200",        // Grid power in W (+import/-export)
      "load_power": "1800",         // Home load in W
      "bms_power": "500",           // Battery power in W (+charge/-discharge)
      "bms_soc": "75"              // Battery SoC in %
    },
    "today_eq": "12500",            // Daily energy in Wh (string)
    "total_eq": "1250000",          // Total energy in Wh (string)
    "tou_mode": 1                   // Battery working mode (int)
  }
}
```

### 4.5 Cloud API Data Fields

| Field Path | Type | Unit | Description |
|------------|------|------|-------------|
| `data.reflux_station_data.pv_power` | string | W | Solar PV generation power |
| `data.reflux_station_data.bms_power` | string | W | Battery power (+charge/-discharge) |
| `data.reflux_station_data.bms_soc` | string | % | Battery state of charge |
| `data.reflux_station_data.grid_power` | string | W | Grid power (+import/-export) |
| `data.reflux_station_data.load_power` | string | W | Home load consumption |
| `data.today_eq` | string | Wh | Daily energy production |
| `data.total_eq` | string | Wh | Lifetime energy production |
| `data.tou_mode` | int | — | Battery working mode (1-8) |

**Alternative field names** (varies by firmware/account type):
- `capacitor_power` → same as `pv_power`
- `battery_power`, `bat_power`, `es_power` → same as `bms_power`
- `soc`, `battery_soc`, `es_soc` → same as `bms_soc`
- `meter_power` → same as `grid_power`
- `home_load_power` → same as `load_power`
- `co_energy` → same as `today_eq`
- `work_mode`, `ems` → same as `tou_mode`

### 4.6 Battery Settings (Async Job Flow)

Reading and writing battery settings uses an async job polling pattern:

1. **Write request** → returns `job_id`
2. **Poll** `/pvm-ctl/api/0/dev/setting/job_status` with `job_id`
3. **Status:** `done`/`completed`/`1` = success, `failed`/`error`/`-1` = failure

**Settings payload fields:**
| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `work_mode` | int | 1-8 | Battery operating mode |
| `reserve_soc` | int | 0-100 | Reserve SoC (%) |
| `max_soc` | int | 0-100 | Maximum SoC (%) |
| `charge_power` | int | 0-100 | Max charge/discharge power (%) |
| `grid_limit` | int | W | Peak shaving grid limit |

---

## 5. Modbus TCP via DTS-G3 (Port 502)

### 5.1 Connection Details

| Parameter | Value |
|-----------|-------|
| **Protocol** | Modbus TCP (MBAP + PDU) |
| **Default Port** | 502 |
| **Unit ID** | 1 (default, configurable) |
| **Supported Function Codes** | FC03 (Read Holding Registers), FC04 (Read Input Registers), FC06 (Write Single Register) |
| **Max Registers per Request** | 125 (Modbus protocol limit) |
| **Timeout** | 8000ms recommended |

### 5.2 Register Map — DTU-Pro / DTS-G3 Standard

This register map is based on the **Hoymiles Technical Note V1.2** (DTU-Pro) and has been confirmed working via community projects (`wasilukm/hoymiles_modbus`, `ArekKubacki/Hoymiles-Plant-DTU-Pro`).

#### 5.2.1 DTU Info Block (0x0000–0x002F)

| Register | Size | Format | Scale | Description |
|----------|------|--------|-------|-------------|
| 0x0000–0x0005 | 6 regs | ASCII | — | DTU serial number (12 chars) |
| 0x0006–0x000B | 6 regs | ASCII | — | DTU firmware version |
| 0x000C–0x000F | 4 regs | U32×2 | — | DTU time (epoch) |

#### 5.2.2 PV Port Data (0x1000 + n×40)

Each PV port occupies 40 registers. Port 0 starts at 0x1000, Port 1 at 0x1028, Port 2 at 0x1050, Port 3 at 0x1078.

| Offset | Register (Port 0) | Size | Format | Scale | Unit | Description |
|--------|-------------------|------|--------|-------|------|-------------|
| +0 | 0x1000 | 1 | U16 | ×0.1 | V | PV voltage |
| +1 | 0x1001 | 1 | U16 | ×0.01 | A | PV current |
| +2 | 0x1002 | 1 | U16 | ×0.1 | V | Grid voltage |
| +3 | 0x1003 | 1 | U16 | ×0.01 | Hz | Grid frequency |
| +4 | 0x1004 | 1 | U16 | ×0.1 | W | PV power |
| +5,+6 | 0x1005–0x1006 | 2 | U32 | /1000 | kWh | Energy today (Wh) |
| +7,+8 | 0x1007–0x1008 | 2 | U32 | /1000 | kWh | Energy total (Wh) |
| +9 | 0x1009 | 1 | S16 | ×0.1 | °C | Temperature |
| +10 | 0x100A | 1 | U16 | — | — | Operating status |
| +11 | 0x100B | 1 | U16 | — | — | Alarm code |
| +12 | 0x100C | 1 | U16 | — | — | Alarm count |
| +13 | 0x100D | 1 | U16 | — | — | Link status |

**Port addresses:**
| Port | Start Register | Label |
|------|---------------|-------|
| 0 | 0x1000 (4096) | PV Port 0 |
| 1 | 0x1028 (4136) | PV Port 1 |
| 2 | 0x1050 (4176) | PV Port 2 |
| 3 | 0x1078 (4216) | PV Port 3 |

#### 5.2.3 Plant Aggregate Data (0x2000–0x200F)

| Offset | Register | Size | Format | Scale | Unit | Description |
|--------|----------|------|--------|-------|------|-------------|
| +0,+1 | 0x2000–0x2001 | 2 | U32 | ×0.1 | W | Total PV power |
| +2,+3 | 0x2002–0x2003 | 2 | U32 | /1000 | kWh | Daily energy (Wh) |
| +4,+5 | 0x2004–0x2005 | 2 | U32 | /1000 | kWh | Total energy (Wh) |
| +6 | 0x2006 | 1 | U16 | — | — | Alarm flag |

#### 5.2.4 Control Registers

| Register | FC | Value | Description |
|----------|----|-------|-------------|
| 0x2000 | FC06 | 0=off, 1=on | Inverter on/off (community-discovered) |
| 0x2001 | FC06 | 20-1000 | Power limit (% × 10, e.g. 50% = 500) |

> **WARNING:** Writing to EEPROM registers — max 10 changes/day recommended.

#### 5.2.5 ESS Candidate Blocks (UNVERIFIED for HiOne/HiBox)

These register ranges have been probed on the HiOne stack but **consistently time out** or return no data:

| Block | Register Range | Expected Content | Status on HiOne |
|-------|---------------|-----------------|-----------------|
| ESS 0x3000 | 0x3000–0x3013 | Battery SoC, power | **TIMEOUT** |
| ESS 0x3100 | 0x3100–0x3113 | Grid power, load | **TIMEOUT** |
| ESS 0x4000 | 0x4000–0x4013 | Mode, settings | **TIMEOUT** |
| ESS 0x5000 | 0x5000–0x5013 | Extended battery | **TIMEOUT** |
| ESS 0x6000 | 0x6000–0x6013 | Reserved | **TIMEOUT** |

### 5.3 HiBox/HiOne Modbus TCP Issues

On the HiBox-63T-G3 gateway:

1. **Plant aggregate (0x2000)** often fails with `ECONNRESET`
2. **PV port registers (0x1000+)** respond but may contain **non-standard data** — the register layout doesn't match DTU-Pro spec
3. **Energy values** at PV offsets can produce garbage (e.g., 613,426 kWh) when the register layout differs
4. **Grid cross-validation**: If no port shows realistic grid voltage (80–280V) or frequency (45–65Hz), the register layout is likely wrong
5. **All ESS blocks (0x3000–0x6000)** time out — no battery/grid/load data is available via Modbus TCP through the DTS-G3

### 5.4 Validation Strategy

The app uses a strict validation approach:
- **Per-port energy validation**: dailyEnergy < 200 kWh, totalEnergy < 500 MWh, daily ≤ total
- **Grid indicator cross-validation**: realistic gridVoltage (80–280V) and gridFreq (45–65Hz)
- **Confidence levels**: `confirmed` (DTU-Pro spec verified), `experimental` (plausible but unverified), `none` (no data)

---

## 6. Local Protobuf Communication (Port 10081)

### 6.1 Overview

The DTS-G3 (and DTU-W/DTU-Pro-S) stick also exposes a **proprietary TCP-based protocol** using Google Protocol Buffers (protobuf) on port **10081**. This is the same protocol the S-Miles Cloud uses to communicate with the DTU.

This protocol provides **full ESS data** including battery, grid, and load information that Modbus TCP does not expose on the HiOne stack.

### 6.2 Available Commands

#### DTU Commands (Microinverter systems)

| Command | Description | Response Data |
|---------|-------------|---------------|
| `get-real-data-new` | Current inverter telemetry | PV power, voltage, current per port, grid data |
| `get-real-data` | Legacy real-time data | Same as above (older format) |
| `get-config` | DTU configuration | Serial, firmware, network config |
| `network-info` | Network information | IP, SSID, signal strength |
| `app-information-data` | Application info | DTU model, firmware version |
| `app-get-hist-power` | Historical power data | Power history array |
| `set-power-limit` | Set power limit (0-100%) | Confirmation |
| `set-wifi` | Configure WiFi | Confirmation |
| `firmware-update` | Firmware update | Status |

#### Hybrid Inverter Commands (HiOne/HAT/HYT/HAS/HYS)

| Command | Description | Response Data |
|---------|-------------|---------------|
| `get-gateway-info` | Gateway information | Serial, model, firmware, network |
| `get-gateway-network-info` | Gateway network config | IP, DNS, DHCP settings |
| `get-energy-storage-registry` | Hybrid inverter info | Model, serial, capabilities |
| **`get-energy-storage-data`** | **Live ESS data** | **PV, battery, grid, load, SoC, mode** |
| `set-energy-storage-working-mode` | Set battery mode | Confirmation |

### 6.3 `get-energy-storage-data` Response Fields

This is the **most important command** for ESS monitoring. Response includes:

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `pv_power` | int | W | Total solar PV generation |
| `bms_power` | int | W | Battery charge/discharge power |
| `bms_soc` | int | % | Battery state of charge (0-100) |
| `grid_power` | int | W | Grid import/export power |
| `load_power` | int | W | Home load consumption |
| `work_mode` | int | — | Battery operating mode (1-8) |
| `pv1_power` | int | W | PV string 1 power |
| `pv2_power` | int | W | PV string 2 power |
| `pv1_voltage` | float | V | PV string 1 voltage |
| `pv2_voltage` | float | V | PV string 2 voltage |
| `pv1_current` | float | A | PV string 1 current |
| `pv2_current` | float | A | PV string 2 current |
| `grid_voltage` | float | V | Grid voltage |
| `grid_frequency` | float | Hz | Grid frequency |
| `battery_voltage` | float | V | Battery voltage |
| `battery_current` | float | A | Battery current |
| `battery_temperature` | float | °C | Battery temperature |
| `daily_energy` | float | kWh | Daily energy production |
| `total_energy` | float | kWh | Total energy production |

### 6.4 `set-energy-storage-working-mode` Parameters

| Working Mode | Value | Required Parameters |
|-------------|-------|---------------------|
| Self Consumption | 1 | `inverter-serial-number`, `rev-soc` |
| Economy | 2 | `inverter-serial-number`, `rev-soc`, `time-settings` |
| Backup | 3 | `inverter-serial-number`, `rev-soc` |
| Off-Grid | 4 | `inverter-serial-number`, `rev-soc` |
| Force Charge | 5 | `inverter-serial-number`, `rev-soc`, `max-power` |
| Force Discharge | 6 | `inverter-serial-number`, `rev-soc`, `max-power` |
| Peak Shaving | 7 | `inverter-serial-number`, `rev-soc`, `peak-soc`, `peak-meter-power` |
| Time of Use | 8 | `inverter-serial-number`, `rev-soc`, `time-periods` |

### 6.5 Protocol Details

- **Transport:** Raw TCP on port 10081
- **Framing:** Length-prefixed protobuf messages
- **Serialization:** Google Protocol Buffers (protobuf3)
- **Authentication:** None (local network only)
- **Library reference:** `hoymiles-wifi` Python library by suaveolent

---

## 7. Hybrid Inverter Modbus Register Map (Official — Newer Firmware)

### 7.1 Overview

For **larger Hoymiles hybrid inverters** (HAS, HYS, HAT, HYT series) with direct Ethernet/WLAN/fiber/4G connections (not through a DTS stick), Hoymiles has published a more comprehensive Modbus register map. This document (found via TinkerUnity community) covers:

- **Port 502** (TCP mode, full duplex, slave)
- **Slave addresses:** 0 or 247 for plant-level, 1-246 for individual inverters
- **Function codes:** 0x03 (Read RO), 0x04 (Read RW/WO), 0x06 (Write single), 0x10 (Write multiple)

> **Important:** This register map is confirmed for HAT/HYT/HAS/HYS series with direct Ethernet connections. It has **NOT** been confirmed working through the DTS-G3 stick with the HiOne stack. On the HiOne stack, the DTS-G3 appears to only expose the DTU-Pro microinverter register map.

### 7.2 Plant-Level Registers (Slave Address 0 or 247)

These are accessible via slave address 0 (no reply) or 247 (with reply):

| Register | R/W | Size | Description |
|----------|-----|------|-------------|
| Various | RW | — | Plant parameter settings |
| Various | RO | — | Plant ESS related registers |

### 7.3 Hybrid Inverter Running Information (Read-Only)

Accessible with valid inverter slave address (1-246):

| Category | Description |
|----------|-------------|
| PV Strings | PV voltage, current, power per string (count depends on model) |
| Grid | Grid voltage (per phase), grid frequency, grid power |
| Battery | Battery voltage, current, power, SoC, temperature |
| Load | Load power |
| Energy | Daily/total energy production, import, export |
| Status | Operating mode, alarm codes, fault codes |

### 7.4 Hybrid Inverter Parameter Settings (Holding Registers)

Accessible with valid inverter slave address (1-246):

| Category | Description |
|----------|-------------|
| Power Control | Active/reactive power limits |
| ESS Settings | Working mode, reserve SoC, max SoC, charge/discharge limits |
| Grid Settings | Grid connection parameters |
| Remote Control | Remote control mode enable/disable |

> **Note:** Power control registers take effect only when remote control mode value is 0.

### 7.5 Applicability to HiOne Stack

The HiOne-16T-G3 is part of the newer "G3" generation. Whether these registers are accessible through the DTS-G3 stick or only via direct connection to the inverter's communication port remains **unverified**. Testing suggests:

- **Through DTS-G3:** Only DTU-Pro microinverter registers (0x0000–0x2FFF) are accessible
- **Direct connection to HiOne COM port:** May expose the full hybrid register map (untested)
- **Through HiBox gateway:** ESS registers time out (see Section 5.3)

---

## 8. Complete Data Element Mapping Table

### 8.1 Telemetry Data (Read)

| Data Element | Unit | Cloud API | Modbus TCP (DTS-G3) | Protobuf (10081) | Notes |
|-------------|------|-----------|---------------------|------------------|-------|
| **PV Power (total)** | W | `reflux_station_data.pv_power` | 0x2000–0x2001 (U32×0.1) | `pv_power` | All three sources confirmed |
| **PV Power (per string)** | W | Not available | 0x1000+n×40+4 (U16×0.1) | `pv1_power`, `pv2_power` | Modbus per port, protobuf per string |
| **PV Voltage** | V | Not available | 0x1000+n×40+0 (U16×0.1) | `pv1_voltage`, `pv2_voltage` | |
| **PV Current** | A | Not available | 0x1000+n×40+1 (U16×0.01) | `pv1_current`, `pv2_current` | |
| **Grid Voltage** | V | Not available | 0x1000+n×40+2 (U16×0.1) | `grid_voltage` | Modbus: per port; Protobuf: per phase |
| **Grid Frequency** | Hz | Not available | 0x1000+n×40+3 (U16×0.01) | `grid_frequency` | |
| **Grid Power** | W | `reflux_station_data.grid_power` | **Not available (ESS timeout)** | `grid_power` | +import/-export |
| **Load Power** | W | `reflux_station_data.load_power` | **Not available (ESS timeout)** | `load_power` | Home consumption |
| **Battery Power** | W | `reflux_station_data.bms_power` | **Not available (ESS timeout)** | `bms_power` | +charge/-discharge |
| **Battery SoC** | % | `reflux_station_data.bms_soc` | **Not available (ESS timeout)** | `bms_soc` | 0-100 |
| **Battery Voltage** | V | Not available | **Not available (ESS timeout)** | `battery_voltage` | |
| **Battery Current** | A | Not available | **Not available (ESS timeout)** | `battery_current` | |
| **Battery Temperature** | °C | Not available | **Not available (ESS timeout)** | `battery_temperature` | |
| **Inverter Temperature** | °C | Not available | 0x1000+n×40+9 (S16×0.1) | Available | |
| **Daily Energy** | kWh | `data.today_eq` (Wh÷1000) | 0x2002–0x2003 (U32, Wh÷1000) | `daily_energy` | API returns Wh as string |
| **Total Energy** | kWh | `data.total_eq` (Wh÷1000) | 0x2004–0x2005 (U32, Wh÷1000) | `total_energy` | |
| **Battery Mode** | enum | `data.tou_mode` | **Not available (ESS timeout)** | `work_mode` | 1-8 (see Section 9) |
| **Operating Status** | enum | Not available | 0x1000+n×40+10 | Available | Per inverter/port |
| **Alarm Code** | int | Not available | 0x1000+n×40+11 | Available | |
| **Alarm Count** | int | Not available | 0x1000+n×40+12 | Available | |
| **Link Status** | enum | Not available | 0x1000+n×40+13 | Available | |
| **Alarm Flag** | bool | Not available | 0x2006 | Available | Plant-level |

### 8.2 Control Data (Write)

| Action | Cloud API | Modbus TCP | Protobuf | Notes |
|--------|-----------|------------|----------|-------|
| **Set Battery Mode** | `SETTING_WRITE` (action_id: 1013) | Not available | `set-energy-storage-working-mode` | |
| **Set Reserve SoC** | `SETTING_WRITE` (action_id: 1014) | Not available | `set-energy-storage-working-mode` | |
| **Set Max SoC** | `SETTING_WRITE` (action_id: 1014) | Not available | `set-energy-storage-working-mode` | |
| **Set Power Limit** | Not directly available | 0x2001 (FC06, %×10) | `set-power-limit` | Modbus: EEPROM write limit |
| **Inverter On/Off** | Not directly available | 0x2000 (FC06, 0/1) | Available | Community-discovered |
| **Set Relay** | `RELAY_CTRL` | Not available | Not available | Cloud only |

### 8.3 Info/Config Data

| Data Element | Cloud API | Modbus TCP | Protobuf |
|-------------|-----------|------------|----------|
| **Station List** | `station/select_by_page` | N/A | N/A |
| **Device List** | `dev/select_by_page` | N/A | N/A |
| **DTU Serial** | Station info → `sn` | 0x0000–0x0005 (ASCII) | `get-gateway-info` |
| **Firmware Version** | Device info → `sw_version` | 0x0006–0x000B (ASCII) | `get-gateway-info` |
| **Network Info** | Not available | N/A | `network-info` / `get-gateway-network-info` |
| **Inverter Info** | Device info | N/A | `get-energy-storage-registry` |

---

## 9. Battery Mode Reference

| Mode ID | Mode Name | Description | Parameters |
|---------|-----------|-------------|------------|
| 1 | Self-Consumption | Maximize self-use of solar energy | `reserve_soc` |
| 2 | Economy | Time-based charge/discharge scheduling | `reserve_soc`, `time_settings` |
| 3 | Backup | Maintain battery for backup power | `reserve_soc` |
| 4 | Off-Grid | Operate without grid connection | `reserve_soc` |
| 5 | Force Charge (Self-Consumption + Max Power) | Force battery charging | `reserve_soc`, `max_power` |
| 6 | Force Discharge (Backup + Max Power) | Force battery discharging | `reserve_soc`, `max_power` |
| 7 | Peak Shaving | Limit grid import to a threshold | `reserve_soc`, `peak_soc`, `peak_meter_power` |
| 8 | Time of Use | Schedule-based operation with TOU tariffs | `reserve_soc`, `time_periods` |

---

## 10. Community Projects & GitHub Repositories

### 10.1 Key Projects

| Project | Language | Protocol | Description | Link |
|---------|----------|----------|-------------|------|
| **suaveolent/hoymiles-wifi** | Python | Protobuf (local) | Primary library for local protobuf communication with DTUs and hybrid inverters. Supports all ESS commands. | [GitHub](https://github.com/suaveolent/hoymiles-wifi) |
| **suaveolent/ha-hoymiles-wifi** | Python | Protobuf (local) | Home Assistant integration using hoymiles-wifi library | [GitHub](https://github.com/suaveolent/ha-hoymiles-wifi) |
| **Philra94/homeassistant-hoymiles-cloud** | Python | Cloud API | Home Assistant integration for cloud API. Reference implementation for Argon2id auth and ESS control. | [GitHub](https://github.com/Philra94/homeassistant-hoymiles-cloud) |
| **wasilukm/hoymiles_modbus** | Python | Modbus TCP | Python library for DTU-Pro Modbus TCP. Well-documented register map for microinverter data. | [GitHub](https://github.com/wasilukm/hoymiles_modbus) |
| **wasilukm/hoymiles-mqtt** | Python | Modbus TCP → MQTT | Bridges Modbus TCP to MQTT for Home Assistant. | [GitHub](https://github.com/wasilukm/hoymiles-mqtt) |
| **ArekKubacki/Hoymiles-Plant-DTU-Pro** | Python | Modbus TCP | Home Assistant integration via Modbus TCP for DTU-Pro. | [GitHub](https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro) |
| **wil-lem/ha-hoymiles-modbus-tcp** | Python | Modbus TCP | Home Assistant integration with power level control. | [GitHub](https://github.com/wil-lem/ha-hoymiles-modbus-tcp) |
| **Eistee82/ioBroker.hoymiles** | JavaScript | Protobuf + Cloud | ioBroker adapter with comprehensive state tree for grid, PV, meter, and station data. | [GitHub](https://github.com/Eistee82/ioBroker.hoymiles) |
| **rovo89/hoymiles_proto** | Python | Protobuf | Low-level protobuf message definitions with renamed/clarified field names. | [GitHub](https://github.com/rovo89/hoymiles_proto) |

### 10.2 Related Community Resources

| Resource | Description | Link |
|----------|-------------|------|
| **Hoymiles Technical Note V1.2** | Official Modbus TCP register map for DTU-Pro | [PDF](https://www.mikrocontroller.net/attachment/552319/Technical-Note-Modbus-implementation-using-3Gen-DTU-Pro-V1.2.pdf) |
| **TinkerUnity Hybrid Modbus Doc** | Community-shared hybrid inverter Modbus register document (HAS/HYT/HAT/HYS) | [Attachment](https://www.tinkerunity.org/applications/core/interface/file/attachment.php?id=4938) |
| **Home Assistant Community Thread** | Discussion on S-Miles Cloud integration | [Forum](https://community.home-assistant.io/t/hoymiles-s-miles-cloud-integration/396899) |
| **ManualsLib HiOne Manual** | Official HiOne Series user manual | [ManualsLib](https://www.manualslib.com/manual/4396282/Hoymiles-Hione-Series.html) |

### 10.3 Protobuf Message Definitions

The protobuf `.proto` files are not officially published by Hoymiles. They have been reverse-engineered by the community:

- **Primary source:** `suaveolent/hoymiles-wifi` — includes `.proto` files for DTU and hybrid inverter commands
- **Alternative:** `rovo89/hoymiles_proto` — renamed and clarified protobuf definitions
- **Key insight:** Hoymiles names `...Req` as "from DTU" and `...Res` as "to DTU" (opposite of typical convention)

---

## 11. Known Issues & Gotchas

### 11.1 Modbus TCP Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| **ESS registers timeout** | 0x3000–0x6000 blocks don't respond on HiOne/HiBox via DTS-G3 | Use protobuf (10081) or cloud API instead |
| **Plant aggregate ECONNRESET** | 0x2000 block often fails on HiBox gateway | Fall back to individual PV port reads |
| **Garbage energy values** | PV port registers return implausible energy data (e.g., 613,426 kWh) | Cross-validate with grid voltage/frequency |
| **Non-standard register layout** | HiBox/HiOne may use different register layout than DTU-Pro | Validate all values; discard if grid indicators are absent |
| **EEPROM write limits** | Control registers (0x2000, 0x2001) write to EEPROM | Limit to max 10 writes/day |
| **Remote Control mode** | DTU app setting "Remote Control" must be enabled for Modbus to work | Configure in Hoymiles Installer app under RS-485 Port Config |

### 11.2 Cloud API Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| **Auth changes** | Hoymiles periodically changes auth flow (MD5 → Argon2id) | Multi-mode auth with fallback |
| **Account lockout** | Too many failed logins trigger account lock (~12h) | Exponential backoff with 12h cooldown |
| **Data latency** | Real-time data can be 30-120s behind actual values | Accept for non-critical use; prefer local protocols |
| **Energy unit ambiguity** | `today_eq` may be Wh (>200) or kWh (<200) | Heuristic: >200 = Wh, divide by 1000 |
| **Field name variations** | Different accounts/firmware return different field names | Deep-find with multiple key alternatives |
| **Token expiry** | Tokens expire after ~2 hours | Automatic re-authentication on 401/403 |

### 11.3 Protobuf Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| **Port 10081 not always open** | Some DTS-G3 firmware versions may not expose port 10081 | Check with network scan; fall back to cloud |
| **Concurrent connection limit** | DTS-G3 may only accept 1-2 simultaneous connections | Use connection pooling with mutex |
| **No official documentation** | Protocol is reverse-engineered | Rely on community libraries |

---

## 12. Recommendations for HiOne Stack Integration

### 12.1 Data Acquisition Strategy

```
Priority 1: Local Protobuf (10081) → Full ESS data, low latency
Priority 2: Cloud API (443)        → Full ESS data, higher latency, needs internet
Priority 3: Modbus TCP (502)       → PV-only data, used for detailed port metrics
```

### 12.2 Hybrid Data Merging

1. Fetch from protobuf first (full ESS data including PV, battery, grid, load, mode)
2. If protobuf fails, fall back to cloud API
3. Optionally supplement with Modbus TCP for per-port PV detail (voltage, current, temperature)
4. Use confidence levels to track data source reliability

### 12.3 Modbus TCP Discovery Tool

For users wanting to explore Modbus registers on their specific hardware:

1. **Quick Scan:** Read known blocks (DTU info, PV ports, plant aggregate)
2. **ESS Probe:** Test candidate ESS blocks with plausibility validation
3. **Deep Scan:** Sweep 0x0000–0xFFFF testing both FC03 and FC04
4. **Export:** Generate shareable JSON report for community analysis

### 12.4 Future Possibilities

- **Direct connection to HiOne COM port:** Bypassing DTS-G3 may unlock the full hybrid Modbus register map
- **Firmware updates:** Hoymiles may add ESS registers to DTS-G3 in future firmware
- **Community register discovery:** The built-in validation engine (ModbusValidator) can correlate Modbus register values with known cloud/protobuf data to discover new mappings

---

## 13. Sources & References

### Official Documentation
1. Hoymiles Technical Note: Modbus Implementation using 3Gen DTU-Pro V1.2 — [PDF](https://www.mikrocontroller.net/attachment/552319/Technical-Note-Modbus-implementation-using-3Gen-DTU-Pro-V1.2.pdf)
2. Hoymiles HiOne Series User Manual — [ManualsLib](https://www.manualslib.com/manual/4396282/Hoymiles-Hione-Series.html)
3. S-Miles Cloud Monitoring Platform User Manual — [Hoymiles](https://www.hoymiles.com/?smd_process_download=1&download_id=13683)

### Community Documentation
4. TinkerUnity: Hybrid Inverter Modbus Register Document — [Attachment](https://www.tinkerunity.org/applications/core/interface/file/attachment.php?id=4938&key=c1b3f1f55412cfca7a9f25fc20458b70)
5. wasilukm/hoymiles_modbus API Documentation — [Docs](https://wasilukm.github.io/hoymiles_modbus/api/)

### GitHub Repositories
6. suaveolent/hoymiles-wifi — [GitHub](https://github.com/suaveolent/hoymiles-wifi)
7. Philra94/homeassistant-hoymiles-cloud — [GitHub](https://github.com/Philra94/homeassistant-hoymiles-cloud)
8. wasilukm/hoymiles_modbus — [GitHub](https://github.com/wasilukm/hoymiles_modbus)
9. wasilukm/hoymiles-mqtt — [GitHub](https://github.com/wasilukm/hoymiles-mqtt)
10. ArekKubacki/Hoymiles-Plant-DTU-Pro — [GitHub](https://github.com/ArekKubacki/Hoymiles-Plant-DTU-Pro)
11. wil-lem/ha-hoymiles-modbus-tcp — [GitHub](https://github.com/wil-lem/ha-hoymiles-modbus-tcp)
12. Eistee82/ioBroker.hoymiles — [GitHub](https://github.com/Eistee82/ioBroker.hoymiles)
13. rovo89/hoymiles_proto — [GitHub](https://github.com/rovo89/hoymiles_proto)

### Community Discussions
14. Home Assistant Community: Hoymiles S-Miles Cloud Integration — [Forum](https://community.home-assistant.io/t/hoymiles-s-miles-cloud-integration/396899)

---

> **Disclaimer:** This report is based on reverse-engineered APIs, community research, and unofficial documentation. Hoymiles may change protocols, register maps, or API endpoints at any time without notice. This information is provided as-is for educational and integration development purposes. Always verify register mappings on your specific hardware before relying on them for critical operations.
