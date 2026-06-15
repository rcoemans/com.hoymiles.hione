'use strict';

/**
 * ModbusTcpClient.js
 * Modbus TCP client for Hoymiles DTS-G3 (and DTU-Pro) sticks.
 *
 * Implements Modbus TCP (MBAP + PDU) using Node.js built-in `net` module.
 * Supports FC03 (Read Holding Registers) and FC04 (Read Input Registers).
 *
 * Standard Hoymiles Modbus TCP port: 502
 *
 * Register map (based on Hoymiles Technical Note V1.2 & community research):
 *
 *   DTU info       : 0x0000 – 0x002F  (serial, firmware, time)
 *   Inverter data  : 0x1000 + n*40    (per PV port: voltage, current, power, energy, temp, status)
 *   Plant aggregate: 0x2000 – 0x200F  (total power, daily energy, total energy)
 *
 * For HiOne battery/ESS data the exact register addresses are firmware-dependent;
 * use scanRegisters() to discover non-zero ranges on your device.
 */

const net = require('net');

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORT   = 502;
const DEFAULT_UNIT   = 1;
const TIMEOUT_MS     = 8_000;
const MAX_REGS_READ  = 125;    // Modbus protocol limit per request

const FC = {
  READ_HOLDING: 0x03,
  READ_INPUT:   0x04,
};

// Known register blocks for Hoymiles DTU / DTS-G3
const KNOWN_BLOCKS = {
  DTU_INFO:   { start: 0x0000, count: 48, label: 'DTU info' },
  PV_PORT_0:  { start: 0x1000, count: 40, label: 'PV port 0' },
  PV_PORT_1:  { start: 0x1028, count: 40, label: 'PV port 1' },
  PV_PORT_2:  { start: 0x1050, count: 40, label: 'PV port 2' },
  PV_PORT_3:  { start: 0x1078, count: 40, label: 'PV port 3' },
  PLANT_AGG:  { start: 0x2000, count: 16, label: 'Plant aggregate' },
};

// Register offsets within each PV port block (40 registers per port)
const PV_OFFSETS = {
  PV_VOLTAGE:     0,   // 0.1 V
  PV_CURRENT:     1,   // 0.01 A
  GRID_VOLTAGE:   2,   // 0.1 V
  GRID_FREQUENCY: 3,   // 0.01 Hz
  PV_POWER:       4,   // 0.1 W
  ENERGY_TODAY_H: 5,   // U32 high word (Wh)
  ENERGY_TODAY_L: 6,   // U32 low word
  ENERGY_TOTAL_H: 7,   // U32 high word (Wh)
  ENERGY_TOTAL_L: 8,   // U32 low word
  TEMPERATURE:    9,   // 0.1 °C  (signed)
  OPER_STATUS:    10,
  ALARM_CODE:     11,
  ALARM_COUNT:    12,
  LINK_STATUS:    13,
};

// Plant aggregate offsets (register 0x2000+)
const PLANT_OFFSETS = {
  TOTAL_POWER_H:       0,   // U32, 0.1 W
  TOTAL_POWER_L:       1,
  DAILY_ENERGY_H:      2,   // U32, Wh
  DAILY_ENERGY_L:      3,
  TOTAL_ENERGY_H:      4,   // U32, Wh
  TOTAL_ENERGY_L:      5,
  ALARM_FLAG:          6,
};

// ── MBAP helpers ─────────────────────────────────────────────────────────────

let _transactionId = 0;
function nextTxId() {
  _transactionId = (_transactionId + 1) & 0xFFFF;
  return _transactionId;
}

/**
 * Build a Modbus TCP request frame (MBAP header + PDU).
 * @param {number} unitId
 * @param {number} fc        Function code (0x03 or 0x04)
 * @param {number} startReg  Starting register address
 * @param {number} count     Number of registers to read
 * @returns {{ txId: number, frame: Buffer }}
 */
function buildReadRequest(unitId, fc, startReg, count) {
  const txId = nextTxId();
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(txId, 0);          // Transaction ID
  buf.writeUInt16BE(0, 2);             // Protocol ID (always 0)
  buf.writeUInt16BE(6, 4);             // Length (Unit + FC + 4 data bytes)
  buf.writeUInt8(unitId, 6);           // Unit ID
  buf.writeUInt8(fc, 7);               // Function code
  buf.writeUInt16BE(startReg, 8);      // Starting register
  buf.writeUInt16BE(count, 10);        // Number of registers
  return { txId, frame: buf };
}

/**
 * Parse a Modbus TCP response frame.
 * Returns array of register values (16-bit unsigned).
 * @param {Buffer} data
 * @param {number} expectedTxId
 * @returns {number[]}
 */
function parseReadResponse(data, expectedTxId) {
  if (!data || data.length < 9) throw new Error('Modbus response too short');

  const txId       = data.readUInt16BE(0);
  const protocolId = data.readUInt16BE(2);
  const length     = data.readUInt16BE(4);
  const unitId     = data.readUInt8(6);
  const fc         = data.readUInt8(7);

  if (protocolId !== 0) throw new Error(`Invalid Modbus protocol ID: ${protocolId}`);

  // Check for exception response (FC with high bit set)
  if (fc & 0x80) {
    const exCode = data.length > 8 ? data.readUInt8(8) : 0;
    const exNames = { 1: 'Illegal Function', 2: 'Illegal Data Address', 3: 'Illegal Data Value', 4: 'Server Failure' };
    throw new Error(`Modbus exception ${exCode}: ${exNames[exCode] || 'Unknown'}`);
  }

  const byteCount = data.readUInt8(8);
  if (data.length < 9 + byteCount) throw new Error('Modbus response truncated');

  const registers = [];
  for (let i = 0; i < byteCount; i += 2) {
    registers.push(data.readUInt16BE(9 + i));
  }
  return registers;
}

// ── TCP transport ────────────────────────────────────────────────────────────

/**
 * Send a Modbus TCP frame and receive the response.
 * @param {string} host
 * @param {number} port
 * @param {Buffer} frame
 * @param {number} timeoutMs
 * @returns {Promise<Buffer>}
 */
function sendReceive(host, port, frame, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks = [];
    let done = false;

    const finish = (err, data) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err); else resolve(data);
    };

    const timer = setTimeout(() => finish(new Error('Modbus TCP timeout')), timeoutMs);

    socket.connect(port, host, () => {
      socket.write(frame);
    });

    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      // Check if we have a complete MBAP frame
      if (buf.length >= 6) {
        const expectedLen = buf.readUInt16BE(4) + 6; // MBAP header (6) + PDU length
        if (buf.length >= expectedLen) {
          clearTimeout(timer);
          finish(null, buf);
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(new Error(`Modbus TCP connection error: ${err.message}`));
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (!done) finish(new Error('Modbus TCP connection closed unexpectedly'));
    });
  });
}

// ── Main class ───────────────────────────────────────────────────────────────

class ModbusTcpClient {

  /**
   * @param {object} opts
   * @param {string} opts.host     IP address of the DTU/DTS stick
   * @param {number} [opts.port]   Modbus TCP port (default 502)
   * @param {number} [opts.unitId] Modbus unit/slave ID (default 1)
   * @param {Function} opts.log
   * @param {Function} opts.error
   */
  constructor({ host, port, unitId, log, error }) {
    this.host   = host;
    this.port   = port || DEFAULT_PORT;
    this.unitId = unitId ?? DEFAULT_UNIT;
    this.log    = log   || (() => {});
    this.error  = error || (() => {});
  }

  // ── Low-level register reads ──────────────────────────────────────────────

  /**
   * Read holding registers (FC03).
   * @param {number} startReg
   * @param {number} count
   * @returns {Promise<number[]>}
   */
  async readHoldingRegisters(startReg, count) {
    if (count > MAX_REGS_READ) throw new Error(`Cannot read more than ${MAX_REGS_READ} registers at once`);
    const { txId, frame } = buildReadRequest(this.unitId, FC.READ_HOLDING, startReg, count);
    const response = await sendReceive(this.host, this.port, frame);
    return parseReadResponse(response, txId);
  }

  /**
   * Read input registers (FC04).
   * @param {number} startReg
   * @param {number} count
   * @returns {Promise<number[]>}
   */
  async readInputRegisters(startReg, count) {
    if (count > MAX_REGS_READ) throw new Error(`Cannot read more than ${MAX_REGS_READ} registers at once`);
    const { txId, frame } = buildReadRequest(this.unitId, FC.READ_INPUT, startReg, count);
    const response = await sendReceive(this.host, this.port, frame);
    return parseReadResponse(response, txId);
  }

  // ── Connectivity check ────────────────────────────────────────────────────

  /**
   * Check if the Modbus TCP endpoint is reachable.
   * @returns {Promise<boolean>}
   */
  async isReachable() {
    try {
      // Try reading DTU info block (register 0x0000, 1 register)
      await this.readHoldingRegisters(0x0000, 1);
      return true;
    } catch (_) {
      try {
        // Fallback: try FC04 input registers
        await this.readInputRegisters(0x0000, 1);
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  // ── High-level data reads ─────────────────────────────────────────────────

  /**
   * Read PV (solar) data from a specific port.
   * @param {number} portIndex 0-based PV port index
   * @returns {Promise<object>}
   */
  async readPvPort(portIndex = 0) {
    const baseReg = 0x1000 + portIndex * 40;
    const regs = await this._readRegsAuto(baseReg, 14);

    return {
      pvVoltage:    regs[PV_OFFSETS.PV_VOLTAGE] * 0.1,
      pvCurrent:    regs[PV_OFFSETS.PV_CURRENT] * 0.01,
      gridVoltage:  regs[PV_OFFSETS.GRID_VOLTAGE] * 0.1,
      gridFreq:     regs[PV_OFFSETS.GRID_FREQUENCY] * 0.01,
      pvPower:      regs[PV_OFFSETS.PV_POWER] * 0.1,
      energyToday:  this._u32(regs, PV_OFFSETS.ENERGY_TODAY_H) / 1000, // Wh → kWh
      energyTotal:  this._u32(regs, PV_OFFSETS.ENERGY_TOTAL_H) / 1000, // Wh → kWh
      temperature:  this._i16(regs[PV_OFFSETS.TEMPERATURE]) * 0.1,
      operStatus:   regs[PV_OFFSETS.OPER_STATUS],
      alarmCode:    regs[PV_OFFSETS.ALARM_CODE],
      alarmCount:   regs[PV_OFFSETS.ALARM_COUNT],
      linkStatus:   regs[PV_OFFSETS.LINK_STATUS],
    };
  }

  /**
   * Read plant aggregate data.
   * @returns {Promise<object>}
   */
  async readPlantData() {
    const regs = await this._readRegsAuto(0x2000, 7);
    return {
      totalPower:  this._u32(regs, PLANT_OFFSETS.TOTAL_POWER_H) * 0.1,   // W
      dailyEnergy: this._u32(regs, PLANT_OFFSETS.DAILY_ENERGY_H) / 1000, // kWh
      totalEnergy: this._u32(regs, PLANT_OFFSETS.TOTAL_ENERGY_H) / 1000, // kWh
      alarmFlag:   regs[PLANT_OFFSETS.ALARM_FLAG],
    };
  }

  /**
   * Read combined data suitable for the HiOne device.
   * Attempts plant aggregate first, then individual PV ports.
   * For battery/ESS data, also tries known ESS register ranges.
   * @returns {Promise<object>}
   */
  async getData() {
    let pvPower = 0, dailyEnergy = 0, totalEnergy = 0;

    // Try plant aggregate first
    try {
      const plant = await this.readPlantData();
      pvPower     = plant.totalPower;
      dailyEnergy = plant.dailyEnergy;
      totalEnergy = plant.totalEnergy;
      this.log(`[Modbus] Plant data: power=${pvPower}W daily=${dailyEnergy}kWh total=${totalEnergy}kWh`);
    } catch (err) {
      this.log(`[Modbus] Plant aggregate not available (${err.message}), trying PV ports...`);
      // Fallback: sum individual PV ports
      for (let i = 0; i < 4; i++) {
        try {
          const port = await this.readPvPort(i);
          pvPower     += port.pvPower;
          dailyEnergy += port.energyToday;
          totalEnergy += port.energyTotal;
        } catch (_) {
          break; // No more ports
        }
      }
    }

    // Try ESS (battery) registers — firmware-dependent
    let batterySoc = 0, batteryPower = 0, gridPower = 0, loadPower = 0, batteryMode = '0';
    try {
      const ess = await this._tryReadEssData();
      if (ess) {
        batterySoc   = ess.batterySoc;
        batteryPower = ess.batteryPower;
        gridPower    = ess.gridPower;
        loadPower    = ess.loadPower;
        batteryMode  = ess.batteryMode;
      }
    } catch (err) {
      this.log(`[Modbus] ESS data not available: ${err.message}`);
    }

    return {
      pvPower:      Math.round(pvPower),
      batteryPower: Math.round(batteryPower),
      batterySoc:   Math.round(batterySoc),
      gridPower:    Math.round(gridPower),
      loadPower:    Math.round(loadPower),
      batteryMode,
      dailyEnergy:  Math.round(dailyEnergy * 100) / 100,
      totalEnergy:  Math.round(totalEnergy * 100) / 100,
      source:       'local',
    };
  }

  /**
   * Try reading ESS/battery registers from common Hoymiles register ranges.
   * These addresses are firmware-dependent; returns null if none respond.
   * @returns {Promise<object|null>}
   */
  async _tryReadEssData() {
    // Try several candidate register blocks that Hoymiles firmware may expose
    // for battery/ESS data. These are based on community findings for HiOne/HMS-ESS.
    const candidates = [
      { start: 0x3000, count: 20, label: 'ESS block 0x3000' },
      { start: 0x4000, count: 20, label: 'ESS block 0x4000' },
      { start: 0x3100, count: 20, label: 'ESS block 0x3100' },
    ];

    for (const block of candidates) {
      try {
        const regs = await this._readRegsAuto(block.start, block.count);
        // Heuristic: if we get data with plausible values, parse it
        const nonZero = regs.filter(v => v !== 0).length;
        if (nonZero < 2) continue; // Likely empty/unsupported

        this.log(`[Modbus] Found ESS data at ${block.label}: ${regs.slice(0, 10).join(',')}`);

        // Parse based on common patterns (best-effort)
        return {
          batterySoc:   this._clampPct(regs[0]),
          batteryPower: this._signedWatts(regs[1], regs[2]),
          gridPower:    this._signedWatts(regs[3], regs[4]),
          loadPower:    Math.abs(this._signedWatts(regs[5], regs[6])),
          batteryMode:  String(regs[7] || 0),
        };
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  // ── Register scanning ─────────────────────────────────────────────────────

  /**
   * Scan a range of registers and report which ones have non-zero values.
   * Useful for discovering the register map on unknown firmware.
   * @param {number} startReg
   * @param {number} endReg    Inclusive
   * @param {number} chunkSize Registers per request (max 125)
   * @returns {Promise<Array<{ address: number, value: number }>>}
   */
  async scanRegisters(startReg = 0x0000, endReg = 0x5000, chunkSize = 50) {
    const results = [];
    for (let addr = startReg; addr <= endReg; addr += chunkSize) {
      const count = Math.min(chunkSize, endReg - addr + 1);
      try {
        const regs = await this._readRegsAuto(addr, count);
        for (let i = 0; i < regs.length; i++) {
          if (regs[i] !== 0) {
            results.push({ address: addr + i, hex: '0x' + (addr + i).toString(16).padStart(4, '0'), value: regs[i] });
          }
        }
      } catch (_) {
        // Block not readable — skip
      }
    }
    this.log(`[Modbus] Scan 0x${startReg.toString(16)}-0x${endReg.toString(16)}: ${results.length} non-zero registers found`);
    return results;
  }

  /**
   * Quick scan of known Hoymiles register blocks.
   * Returns a structured report.
   * @returns {Promise<object>}
   */
  async scanKnownBlocks() {
    const report = {};
    for (const [name, block] of Object.entries(KNOWN_BLOCKS)) {
      try {
        const regs = await this._readRegsAuto(block.start, block.count);
        const nonZero = regs.map((v, i) => v !== 0 ? { offset: i, addr: block.start + i, hex: '0x' + (block.start + i).toString(16).padStart(4, '0'), value: v } : null).filter(Boolean);
        report[name] = { label: block.label, start: block.start, regs: nonZero, total: regs.length, readable: true };
      } catch (err) {
        report[name] = { label: block.label, start: block.start, readable: false, error: err.message };
      }
    }
    return report;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Try FC03 first, fall back to FC04.
   * @param {number} startReg
   * @param {number} count
   * @returns {Promise<number[]>}
   */
  async _readRegsAuto(startReg, count) {
    try {
      return await this.readHoldingRegisters(startReg, count);
    } catch (err) {
      // If FC03 fails with "Illegal Function", try FC04
      if (err.message && err.message.includes('Illegal Function')) {
        return await this.readInputRegisters(startReg, count);
      }
      throw err;
    }
  }

  /** Combine two 16-bit registers into a 32-bit unsigned value. */
  _u32(regs, highIdx) {
    return ((regs[highIdx] || 0) << 16) | (regs[highIdx + 1] || 0);
  }

  /** Interpret a 16-bit register as signed. */
  _i16(val) {
    return val > 0x7FFF ? val - 0x10000 : val;
  }

  /** Interpret two registers as a signed 32-bit watt value. */
  _signedWatts(high, low) {
    const u = ((high || 0) << 16) | (low || 0);
    // Interpret as signed 32-bit
    const v = u > 0x7FFFFFFF ? u - 0x100000000 : u;
    // Scale: values > 100000 are likely 0.1W
    return Math.abs(v) > 100_000 ? Math.round(v / 10) : v;
  }

  /** Clamp a percentage value (handle 0-100 and 0-10000 ranges). */
  _clampPct(val) {
    const v = val || 0;
    if (v > 10000) return 100;
    if (v > 100) return Math.round(v / 100);
    return v;
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = ModbusTcpClient;
module.exports.DEFAULT_PORT  = DEFAULT_PORT;
module.exports.KNOWN_BLOCKS  = KNOWN_BLOCKS;
module.exports.PV_OFFSETS    = PV_OFFSETS;
module.exports.PLANT_OFFSETS = PLANT_OFFSETS;
