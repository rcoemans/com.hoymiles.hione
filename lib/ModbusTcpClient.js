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

// Candidate ESS register blocks (firmware-dependent, UNVERIFIED for HiOne)
const ESS_CANDIDATE_BLOCKS = [
  { start: 0x3000, count: 20, label: 'ESS block 0x3000' },
  { start: 0x3100, count: 20, label: 'ESS block 0x3100' },
  { start: 0x4000, count: 20, label: 'ESS block 0x4000' },
  { start: 0x5000, count: 20, label: 'ESS block 0x5000' },
  { start: 0x6000, count: 20, label: 'ESS block 0x6000' },
];

// Data confidence levels
const CONFIDENCE = {
  CONFIRMED:    'confirmed',    // Register mapping verified by DTU-Pro spec / community
  EXPERIMENTAL: 'experimental', // Plausible but unverified mapping
  NONE:         'none',         // No data available
};

// Plausibility ranges for validation
const PLAUSIBLE = {
  SOC:          { min: 0, max: 100 },
  POWER_W:      { min: -50000, max: 50000 },
  VOLTAGE_V:    { min: 0, max: 1000 },
  CURRENT_A:    { min: 0, max: 100 },
  FREQUENCY_HZ: { min: 40, max: 70 },
  TEMP_C:       { min: -40, max: 100 },
  ENERGY_KWH:   { min: 0, max: 1_000_000 },
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
   * Read combined data from confirmed DTU-Pro register blocks.
   * Only returns values from verified register mappings.
   * ESS/battery data is NOT guessed — use probeEssRegisters() for experimental discovery.
   * @returns {Promise<object>}
   */
  async getData() {
    let pvPower = 0, dailyEnergy = 0, totalEnergy = 0;
    let pvConfidence = CONFIDENCE.NONE;
    let energyConfidence = CONFIDENCE.NONE;

    // Try plant aggregate first (DTU-Pro confirmed register map)
    try {
      const plant = await this.readPlantData();
      if (this._isPlausible(plant.totalPower, PLAUSIBLE.POWER_W)) {
        pvPower = plant.totalPower;
        pvConfidence = CONFIDENCE.CONFIRMED;
      }
      if (this._isPlausible(plant.dailyEnergy, PLAUSIBLE.ENERGY_KWH) ||
          this._isPlausible(plant.totalEnergy, PLAUSIBLE.ENERGY_KWH)) {
        dailyEnergy = plant.dailyEnergy;
        totalEnergy = plant.totalEnergy;
        energyConfidence = CONFIDENCE.CONFIRMED;
      }
      this.log(`[Modbus] Plant data: power=${pvPower}W daily=${dailyEnergy}kWh total=${totalEnergy}kWh (pv:${pvConfidence} energy:${energyConfidence})`);
    } catch (err) {
      this.log(`[Modbus] Plant aggregate not available (${err.message}), trying PV ports...`);
      // Fallback: sum individual PV ports with strict validation
      let anyPortValid = false;
      let gridIndicators = 0;  // track if any port has realistic grid voltage/freq
      for (let i = 0; i < 4; i++) {
        try {
          const port = await this.readPvPort(i);
          // Track grid-tied indicators (grid voltage ≈ 100-260V or freq ≈ 45-65Hz)
          if (port.gridVoltage > 80 && port.gridVoltage < 280) gridIndicators++;
          if (port.gridFreq > 45 && port.gridFreq < 65) gridIndicators++;
          // Validate power and energy per port
          const powerOk = this._isPlausible(port.pvPower, PLAUSIBLE.POWER_W);
          const dailyOk = port.energyToday >= 0 && port.energyToday < 200;  // max 200 kWh/day per port
          const totalOk = port.energyTotal >= 0 && port.energyTotal < 500000; // max 500 MWh lifetime per port
          const energyConsistent = port.energyToday <= port.energyTotal + 0.1 || port.energyTotal === 0;
          if (powerOk && dailyOk && totalOk && energyConsistent) {
            pvPower     += port.pvPower;
            dailyEnergy += port.energyToday;
            totalEnergy += port.energyTotal;
            anyPortValid = true;
          } else {
            this.log(`[Modbus] PV port ${i}: rejected (power=${port.pvPower}W daily=${port.energyToday}kWh total=${port.energyTotal}kWh dailyOk=${dailyOk} totalOk=${totalOk} consistent=${energyConsistent})`);
          }
        } catch (_) {
          break; // No more ports
        }
      }
      // Cross-validation: if no port shows realistic grid indicators,
      // the device likely doesn't follow DTU-Pro register map
      if (gridIndicators === 0 && anyPortValid) {
        this.log('[Modbus] WARNING: No port has realistic grid voltage/frequency — register layout may differ from DTU-Pro spec. Discarding PV port energy data.');
        // Keep pvPower (likely near 0) but zero out energy — it's unreliable
        dailyEnergy = 0;
        totalEnergy = 0;
        energyConfidence = CONFIDENCE.NONE;
      }
      if (anyPortValid) pvConfidence = CONFIDENCE.CONFIRMED;
    }

    // ESS data is NOT guessed from random registers
    this.log('[Modbus] ESS data: not probed (use probeEssRegisters() for experimental discovery)');

    return {
      pvPower:      Math.round(pvPower),
      batteryPower: 0,
      batterySoc:   0,
      gridPower:    0,
      loadPower:    0,
      batteryMode:  '0',
      dailyEnergy:  Math.round(dailyEnergy * 100) / 100,
      totalEnergy:  Math.round(totalEnergy * 100) / 100,
      source:       'modbus',
      confidence: {
        pvPower:      pvConfidence,
        dailyEnergy:  energyConfidence,
        totalEnergy:  energyConfidence,
        batteryPower: CONFIDENCE.NONE,
        batterySoc:   CONFIDENCE.NONE,
        gridPower:    CONFIDENCE.NONE,
        loadPower:    CONFIDENCE.NONE,
        batteryMode:  CONFIDENCE.NONE,
      },
    };
  }

  /**
   * Experimental ESS register discovery with strict validation.
   * Tries candidate register blocks and validates values for plausibility.
   * This is SEPARATE from getData() — results are not trusted for capabilities
   * unless explicitly confirmed by the user or cloud-vs-Modbus comparison.
   * @returns {Promise<object|null>}
   */
  async probeEssRegisters() {
    this.log('[Modbus] Starting experimental ESS register probe...');

    for (const block of ESS_CANDIDATE_BLOCKS) {
      try {
        const regs = await this._readRegsAuto(block.start, block.count);
        const nonZero = regs.filter(v => v !== 0).length;
        if (nonZero < 2) continue;

        this.log(`[Modbus] ESS candidate ${block.label}: ${nonZero}/${block.count} non-zero — raw: [${regs.slice(0, 10).join(', ')}]`);

        const essData = this._tryParseEssBlock(regs, block);
        if (essData) {
          this.log(`[Modbus] Plausible ESS data at ${block.label}: soc=${essData.batterySoc}% bat=${essData.batteryPower}W grid=${essData.gridPower}W load=${essData.loadPower}W mode=${essData.batteryMode}`);
          return {
            found: true,
            block: block.label,
            startAddress: block.start,
            data: essData,
            confidence: CONFIDENCE.EXPERIMENTAL,
            rawRegisters: regs,
          };
        }
      } catch (err) {
        this.log(`[Modbus] ESS probe ${block.label}: ${err.message}`);
      }
    }

    this.log('[Modbus] No plausible ESS data found in candidate blocks');
    return null;
  }

  /**
   * Try to parse an ESS register block with plausibility checks.
   * Returns parsed data only if at least 3 values pass validation.
   * @param {number[]} regs
   * @param {object} block
   * @returns {object|null}
   */
  _tryParseEssBlock(regs, block) {
    const patterns = [
      // Pattern A: SOC + 32-bit signed power values
      () => ({
        soc:       this._clampPct(regs[0]),
        batPower:  this._signedWatts(regs[1], regs[2]),
        gridPower: this._signedWatts(regs[3], regs[4]),
        loadPower: Math.abs(this._signedWatts(regs[5], regs[6])),
        mode:      regs[7] || 0,
      }),
      // Pattern B: SOC + 16-bit signed power values
      () => ({
        soc:       this._clampPct(regs[0]),
        batPower:  this._i16(regs[1]),
        gridPower: this._i16(regs[2]),
        loadPower: Math.abs(this._i16(regs[3])),
        mode:      regs[4] || 0,
      }),
    ];

    for (const tryPattern of patterns) {
      try {
        const { soc, batPower, gridPower, loadPower, mode } = tryPattern();

        let plausibleCount = 0;
        if (this._isPlausible(soc, PLAUSIBLE.SOC)) plausibleCount++;
        if (this._isPlausible(batPower, PLAUSIBLE.POWER_W)) plausibleCount++;
        if (this._isPlausible(gridPower, PLAUSIBLE.POWER_W)) plausibleCount++;
        if (this._isPlausible(loadPower, { min: 0, max: 50000 })) plausibleCount++;
        if (mode >= 0 && mode <= 5) plausibleCount++;

        if (plausibleCount >= 3) {
          return {
            batterySoc:   Math.round(soc),
            batteryPower: Math.round(batPower),
            gridPower:    Math.round(gridPower),
            loadPower:    Math.round(loadPower),
            batteryMode:  String(mode),
          };
        }
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
            results.push(this._interpretRegister(addr + i, regs[i]));
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

    // Scan confirmed DTU-Pro blocks
    for (const [name, block] of Object.entries(KNOWN_BLOCKS)) {
      try {
        const regs = await this._readRegsAuto(block.start, block.count);
        const nonZero = regs.map((v, i) => v !== 0 ? this._interpretRegister(block.start + i, v) : null).filter(Boolean);
        report[name] = { label: block.label, start: block.start, regs: nonZero, total: regs.length, readable: true, confidence: CONFIDENCE.CONFIRMED };
      } catch (err) {
        report[name] = { label: block.label, start: block.start, readable: false, error: err.message };
      }
    }

    // Scan ESS candidate blocks
    for (const block of ESS_CANDIDATE_BLOCKS) {
      const key = 'ESS_' + block.start.toString(16).toUpperCase();
      try {
        const regs = await this._readRegsAuto(block.start, block.count);
        const nonZero = regs.map((v, i) => v !== 0 ? this._interpretRegister(block.start + i, v) : null).filter(Boolean);
        report[key] = { label: block.label, start: block.start, regs: nonZero, total: regs.length, readable: true, confidence: CONFIDENCE.EXPERIMENTAL };
      } catch (err) {
        report[key] = { label: block.label, start: block.start, readable: false, error: err.message };
      }
    }

    return report;
  }

  /**
   * Deep scan: comprehensive register discovery with multiple interpretations.
   * Scans wider range, tests both FC03/FC04, decodes ASCII strings, tests byte orders.
   * @param {number} startReg
   * @param {number} endReg
   * @param {number} chunkSize
   * @returns {Promise<object>}
   */
  async deepScan(startReg = 0x0000, endReg = 0xFFFF, chunkSize = 50) {
    const report = {
      timestamp: new Date().toISOString(),
      host: this.host,
      port: this.port,
      unitId: this.unitId,
      fc03Ranges: [],
      fc04Ranges: [],
      registers: [],
      asciiStrings: [],
      summary: { totalReadable: 0, totalNonZero: 0, blocksScanned: 0 },
    };

    for (let addr = startReg; addr <= endReg; addr += chunkSize) {
      const count = Math.min(chunkSize, endReg - addr + 1);
      report.summary.blocksScanned++;

      // Try FC03 (Holding Registers)
      let regs = null;
      let fc = null;
      try {
        regs = await this.readHoldingRegisters(addr, count);
        fc = 'FC03';
        report.fc03Ranges.push({ start: addr, count });
      } catch (_) {
        // Try FC04 (Input Registers)
        try {
          regs = await this.readInputRegisters(addr, count);
          fc = 'FC04';
          report.fc04Ranges.push({ start: addr, count });
        } catch (__) {
          continue;
        }
      }

      if (!regs) continue;
      report.summary.totalReadable += regs.length;

      // Decode registers with multiple interpretations
      for (let i = 0; i < regs.length; i++) {
        if (regs[i] !== 0) {
          const entry = this._interpretRegister(addr + i, regs[i]);
          entry.fc = fc;
          report.registers.push(entry);
          report.summary.totalNonZero++;
        }
      }

      // Try ASCII string decoding across consecutive registers
      const ascii = this._tryAsciiDecode(regs, addr);
      if (ascii) report.asciiStrings.push(ascii);
    }

    this.log(`[Modbus] Deep scan complete: ${report.summary.totalNonZero} non-zero in ${report.summary.totalReadable} readable registers`);
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

  /** Check if a value falls within a plausible range. */
  _isPlausible(value, range) {
    if (value === null || value === undefined || isNaN(value)) return false;
    return value >= range.min && value <= range.max;
  }

  /**
   * Interpret a single register with multiple formats.
   * Returns an enriched object with address, raw value, and interpretations.
   */
  _interpretRegister(address, value) {
    const entry = {
      address,
      hex: '0x' + address.toString(16).padStart(4, '0'),
      value,
      valueHex: '0x' + value.toString(16).padStart(4, '0'),
      signed: value > 0x7FFF ? value - 0x10000 : value,
      scaled01: Math.round(value * 0.1 * 100) / 100,
      scaled001: Math.round(value * 0.01 * 1000) / 1000,
    };
    // ASCII interpretation (2 chars per register)
    const hi = (value >> 8) & 0xFF;
    const lo = value & 0xFF;
    if (hi >= 0x20 && hi <= 0x7E && lo >= 0x20 && lo <= 0x7E) {
      entry.ascii = String.fromCharCode(hi, lo);
    }
    return entry;
  }

  /**
   * Try to decode consecutive registers as an ASCII string.
   * Returns { startAddr, endAddr, text } or null.
   */
  _tryAsciiDecode(regs, baseAddr) {
    let asciiRun = [];
    let runStart = null;
    const results = [];

    for (let i = 0; i < regs.length; i++) {
      const hi = (regs[i] >> 8) & 0xFF;
      const lo = regs[i] & 0xFF;
      if (hi >= 0x20 && hi <= 0x7E && lo >= 0x20 && lo <= 0x7E) {
        if (runStart === null) runStart = i;
        asciiRun.push(String.fromCharCode(hi, lo));
      } else if (regs[i] === 0 && asciiRun.length > 0) {
        // Null terminator — end of string
        if (asciiRun.length >= 3) {
          results.push({
            startAddr: baseAddr + runStart,
            endAddr: baseAddr + i - 1,
            hex: '0x' + (baseAddr + runStart).toString(16).padStart(4, '0'),
            text: asciiRun.join(''),
          });
        }
        asciiRun = [];
        runStart = null;
      } else {
        if (asciiRun.length >= 3) {
          results.push({
            startAddr: baseAddr + runStart,
            endAddr: baseAddr + i - 1,
            hex: '0x' + (baseAddr + runStart).toString(16).padStart(4, '0'),
            text: asciiRun.join(''),
          });
        }
        asciiRun = [];
        runStart = null;
      }
    }
    // Flush remaining
    if (asciiRun.length >= 3) {
      results.push({
        startAddr: baseAddr + runStart,
        endAddr: baseAddr + regs.length - 1,
        hex: '0x' + (baseAddr + runStart).toString(16).padStart(4, '0'),
        text: asciiRun.join(''),
      });
    }

    return results.length > 0 ? results : null;
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = ModbusTcpClient;
module.exports.DEFAULT_PORT          = DEFAULT_PORT;
module.exports.KNOWN_BLOCKS          = KNOWN_BLOCKS;
module.exports.ESS_CANDIDATE_BLOCKS  = ESS_CANDIDATE_BLOCKS;
module.exports.PV_OFFSETS            = PV_OFFSETS;
module.exports.PLANT_OFFSETS         = PLANT_OFFSETS;
module.exports.CONFIDENCE            = CONFIDENCE;
module.exports.PLAUSIBLE             = PLAUSIBLE;
