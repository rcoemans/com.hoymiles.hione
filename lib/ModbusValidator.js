'use strict';

/**
 * ModbusValidator.js
 *
 * Validation engine for Hoymiles Modbus TCP register discovery.
 * Captures Cloud API data and local Modbus TCP data simultaneously,
 * compares both datasets, and calculates confidence scores over time.
 *
 * Based on: change_requests/hoymiles_homey_api_modbus_validation.md
 */

// ── Candidate registers based on deep scan analysis ───────────────────────────

const CANDIDATE_REGISTERS = [
  // Energy — daily
  { key: 'daily_fc03_4616', fc: 3, address: 4616, words: 1, transform: 'u16_div10', apiField: 'dailyEnergyKWh' },
  { key: 'daily_fc03_4621', fc: 3, address: 4621, words: 1, transform: 'u16_div10', apiField: 'dailyEnergyKWh' },
  { key: 'daily_fc03_4626', fc: 3, address: 4626, words: 1, transform: 'u16_div10', apiField: 'dailyEnergyKWh' },
  { key: 'daily_fc03_4631', fc: 3, address: 4631, words: 1, transform: 'u16_div10', apiField: 'dailyEnergyKWh' },
  { key: 'daily_fc04_12100', fc: 4, address: 12100, words: 1, transform: 'u16_div10', apiField: 'dailyEnergyKWh' },
  { key: 'daily_fc04_12107', fc: 4, address: 12107, words: 1, transform: 'u16_div10', apiField: 'dailyEnergyKWh' },

  // SOC
  { key: 'soc_fc04_10030', fc: 4, address: 10030, words: 1, transform: 'u16', apiField: 'socPct' },
  { key: 'soc_fc04_12115', fc: 4, address: 12115, words: 1, transform: 'u16', apiField: 'socPct' },
  { key: 'soc_fc04_12117', fc: 4, address: 12117, words: 1, transform: 'u16', apiField: 'socPct' },
  { key: 'soc_fc04_12133', fc: 4, address: 12133, words: 1, transform: 'u16', apiField: 'socPct' },

  // Battery power / charge power (sign may be inverted vs API)
  { key: 'battery_power_fc04_51', fc: 4, address: 51, words: 1, transform: 'abs_s16', apiField: 'batteryPowerAbsW' },
  { key: 'battery_power_fc04_193', fc: 4, address: 193, words: 1, transform: 'abs_s16', apiField: 'batteryPowerAbsW' },

  // Grid power (signed 32-bit)
  { key: 'grid_power_fc04_5208', fc: 4, address: 5208, words: 2, transform: 's32_div10', apiField: 'gridPowerW' },

  // Load power
  { key: 'load_power_fc04_12162', fc: 4, address: 12162, words: 1, transform: 'u16_div100', apiField: 'loadPowerW' },
  { key: 'load_power_fc04_10277', fc: 4, address: 10277, words: 1, transform: 'u16', apiField: 'loadPowerW' },

  // Mode / status candidate
  { key: 'mode_fc03_254', fc: 3, address: 254, words: 1, transform: 'u16_div10', apiField: 'mode' },

  // AC voltage candidates (3-phase)
  { key: 'voltage_l1_fc04_62', fc: 4, address: 62, words: 1, transform: 'u16_div10', apiField: null },
  { key: 'voltage_l2_fc04_63', fc: 4, address: 63, words: 1, transform: 'u16_div10', apiField: null },
  { key: 'voltage_l3_fc04_64', fc: 4, address: 64, words: 1, transform: 'u16_div10', apiField: null },

  // Frequency candidates
  { key: 'freq_fc04_65', fc: 4, address: 65, words: 1, transform: 'u16_div100', apiField: null },
  { key: 'freq_fc04_66', fc: 4, address: 66, words: 1, transform: 'u16_div100', apiField: null },

  // Temperature candidates
  { key: 'temp1_fc04_78', fc: 4, address: 78, words: 1, transform: 'u16_div10', apiField: null },
  { key: 'temp2_fc04_79', fc: 4, address: 79, words: 1, transform: 'u16_div10', apiField: null },
  { key: 'temp3_fc04_80', fc: 4, address: 80, words: 1, transform: 'u16_div10', apiField: null },

  // DC / battery / PV voltage candidates
  { key: 'dc_v1_fc04_58', fc: 4, address: 58, words: 1, transform: 'u16_div10', apiField: null },
  { key: 'dc_v2_fc04_59', fc: 4, address: 59, words: 1, transform: 'u16_div10', apiField: null },
  { key: 'dc_v_total_fc04_60', fc: 4, address: 60, words: 1, transform: 'u16_div10', apiField: null },
];

// Candidate block ranges for batch reading
const CANDIDATE_RANGES = [
  { fc: 3, start: 250, count: 40 },
  { fc: 3, start: 4600, count: 40 },
  { fc: 4, start: 50, count: 50 },
  { fc: 4, start: 190, count: 20 },
  { fc: 4, start: 5208, count: 4 },
  { fc: 4, start: 10000, count: 110 },
  { fc: 4, start: 12100, count: 90 },
];

const MAX_VALIDATION_SNAPSHOTS = 5000;

// ── Transform functions ───────────────────────────────────────────────────────

function toSigned16(value) {
  return value > 0x7FFF ? value - 0x10000 : value;
}

function toSigned32(highWord, lowWord) {
  const value = ((highWord & 0xFFFF) << 16) | (lowWord & 0xFFFF);
  return value > 0x7FFFFFFF ? value - 0x100000000 : value;
}

function applyTransform(transform, regs) {
  if (!regs || regs.length === 0) return null;
  const r0 = regs[0];
  switch (transform) {
    case 'u16':           return r0;
    case 'u16_div10':     return Math.round(r0 / 10 * 100) / 100;
    case 'u16_div100':    return Math.round(r0 / 100 * 100) / 100;
    case 's16':           return toSigned16(r0);
    case 'abs_s16':       return Math.abs(toSigned16(r0));
    case 's32_div10':     return regs.length >= 2 ? Math.round(toSigned32(regs[0], regs[1]) / 10 * 100) / 100 : null;
    case 's32_div100':    return regs.length >= 2 ? Math.round(toSigned32(regs[0], regs[1]) / 100 * 100) / 100 : null;
    case 'abs_s32':       return regs.length >= 2 ? Math.abs(toSigned32(regs[0], regs[1])) : null;
    default:              return r0;
  }
}

// ── Confidence scoring ────────────────────────────────────────────────────────

/**
 * Acceptance criteria per API field type.
 */
const ACCEPTANCE = {
  socPct:            { maxAbsDiff: 1,   minSamples: 10 },
  dailyEnergyKWh:   { maxAbsDiff: 0.1, minSamples: 10 },
  batteryPowerAbsW: { maxAbsDiff: 100, minSamples: 20 },
  gridPowerW:       { maxAbsDiff: 100, minSamples: 20 },
  loadPowerW:       { maxAbsDiff: 100, minSamples: 20 },
  mode:             { maxAbsDiff: 0,   minSamples: 5  },
};

class ModbusValidator {

  constructor({ log, error } = {}) {
    this.log = typeof log === 'function' ? log : () => {};
    this.error = typeof error === 'function' ? error : () => {};
    this._snapshots = [];
    this._confidence = {};
    this._validationInProgress = false;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Collect a simultaneous API + Modbus snapshot.
   * @param {Function} fetchApiSnapshot — returns { pvPowerW, batteryPowerW, socPct, gridPowerW, loadPowerW, dailyEnergyKWh, totalEnergyKWh, mode }
   * @param {Function} fetchModbusSnapshot — returns { raw: {}, derived: {} }
   * @returns {object} The snapshot
   */
  async collectSnapshot(fetchApiSnapshot, fetchModbusSnapshot) {
    if (this._validationInProgress) {
      this.log('[Validator] Snapshot already in progress, skipping');
      return null;
    }
    this._validationInProgress = true;
    const timestampStart = new Date();

    try {
      const [apiResult, modbusResult] = await Promise.allSettled([
        fetchApiSnapshot(),
        fetchModbusSnapshot(),
      ]);

      const timestampEnd = new Date();

      const apiData = apiResult.status === 'fulfilled' ? apiResult.value : null;
      const modbusData = modbusResult.status === 'fulfilled' ? modbusResult.value : null;

      // Add abs battery power as derived API field
      if (apiData && apiData.batteryPowerW != null) {
        apiData.batteryPowerAbsW = Math.abs(apiData.batteryPowerW);
      }

      const snapshot = {
        timestampStart: timestampStart.toISOString(),
        timestampEnd: timestampEnd.toISOString(),
        durationMs: timestampEnd.getTime() - timestampStart.getTime(),
        api: apiData,
        modbus: modbusData,
        errors: {
          api: apiResult.status === 'rejected' ? String(apiResult.reason) : null,
          modbus: modbusResult.status === 'rejected' ? String(modbusResult.reason) : null,
        },
        deltas: null,
      };

      // Calculate deltas for each candidate register that has an API counterpart
      if (apiData && modbusData && modbusData.derived) {
        snapshot.deltas = {};
        for (const [key, modbusValue] of Object.entries(modbusData.derived)) {
          const reg = CANDIDATE_REGISTERS.find(r => r.key === key);
          if (!reg || !reg.apiField || apiData[reg.apiField] == null) continue;
          const apiValue = apiData[reg.apiField];
          const diff = modbusValue - apiValue;
          snapshot.deltas[key] = {
            modbusValue,
            apiValue,
            diff: Math.round(diff * 100) / 100,
            absDiff: Math.round(Math.abs(diff) * 100) / 100,
            pctDiff: apiValue !== 0 ? Math.round(Math.abs(diff / apiValue) * 10000) / 100 : null,
          };
        }
      }

      // Store and update confidence
      this._snapshots.push(snapshot);
      if (this._snapshots.length > MAX_VALIDATION_SNAPSHOTS) {
        this._snapshots.splice(0, this._snapshots.length - MAX_VALIDATION_SNAPSHOTS);
      }
      this._updateConfidence(snapshot);

      this.log(`[Validator] Snapshot #${this._snapshots.length}: duration=${snapshot.durationMs}ms api=${apiData ? 'ok' : 'FAIL'} modbus=${modbusData ? 'ok' : 'FAIL'}`);
      return snapshot;

    } finally {
      this._validationInProgress = false;
    }
  }

  /**
   * Read all candidate Modbus registers and apply transforms.
   * @param {object} modbusClient — ModbusTcpClient instance
   * @returns {object} { raw: { 'FC03:4616': 127, ... }, derived: { 'daily_fc03_4616': 12.7, ... } }
   */
  async readCandidateRegisters(modbusClient) {
    const raw = {};
    const derived = {};

    // Read candidate block ranges for efficiency
    const blockCache = {};
    for (const range of CANDIDATE_RANGES) {
      try {
        const regs = range.fc === 3
          ? await modbusClient.readHoldingRegisters(range.start, range.count)
          : await modbusClient.readInputRegisters(range.start, range.count);

        if (regs) {
          for (let i = 0; i < regs.length; i++) {
            const addr = range.start + i;
            blockCache[`FC${String(range.fc).padStart(2, '0')}:${addr}`] = regs[i];
          }
        }
      } catch (err) {
        this.log(`[Validator] Block FC${range.fc}:${range.start}x${range.count} failed: ${err.message}`);
      }
    }

    // Extract individual candidate values
    for (const reg of CANDIDATE_REGISTERS) {
      const fcKey = `FC${String(reg.fc).padStart(2, '0')}`;
      const regs = [];
      let allFound = true;
      for (let w = 0; w < reg.words; w++) {
        const k = `${fcKey}:${reg.address + w}`;
        if (blockCache[k] != null) {
          regs.push(blockCache[k]);
          raw[k] = blockCache[k];
        } else {
          allFound = false;
        }
      }

      if (allFound && regs.length === reg.words) {
        const value = applyTransform(reg.transform, regs);
        if (value != null) {
          derived[reg.key] = value;
        }
      }
    }

    return { raw, derived };
  }

  /**
   * Get the current confidence scores for all candidate registers.
   * @returns {object}
   */
  getConfidence() {
    return { ...this._confidence };
  }

  /**
   * Get the snapshot history.
   * @returns {object[]}
   */
  getSnapshots() {
    return this._snapshots;
  }

  /**
   * Get a summary report suitable for display/export.
   * @returns {object}
   */
  getSummary() {
    const total = this._snapshots.length;
    const lastSnapshot = total > 0 ? this._snapshots[total - 1] : null;
    const confidence = this.getConfidence();

    // Group by confidence level
    const high = [];
    const medium = [];
    const low = [];
    const unresolved = [];

    for (const [key, score] of Object.entries(confidence)) {
      if (score.level === 'high') high.push({ key, ...score });
      else if (score.level === 'medium') medium.push({ key, ...score });
      else if (score.level === 'low') low.push({ key, ...score });
      else unresolved.push({ key, ...score });
    }

    return {
      totalSnapshots: total,
      firstSnapshot: total > 0 ? this._snapshots[0].timestampStart : null,
      lastSnapshot: lastSnapshot ? lastSnapshot.timestampStart : null,
      confidence: { high, medium, low, unresolved },
      candidateCount: CANDIDATE_REGISTERS.length,
    };
  }

  /**
   * Export all data for external analysis.
   * @returns {object}
   */
  exportData() {
    return {
      exportedAt: new Date().toISOString(),
      candidateRegisters: CANDIDATE_REGISTERS,
      candidateRanges: CANDIDATE_RANGES,
      snapshots: this._snapshots,
      confidence: this._confidence,
      summary: this.getSummary(),
    };
  }

  /**
   * Load previously stored snapshots (e.g. from Homey settings).
   * @param {object[]} snapshots
   * @param {object} confidence
   */
  loadState(snapshots, confidence) {
    if (Array.isArray(snapshots)) {
      this._snapshots = snapshots.slice(-MAX_VALIDATION_SNAPSHOTS);
    }
    if (confidence && typeof confidence === 'object') {
      this._confidence = confidence;
    }
    this.log(`[Validator] Loaded ${this._snapshots.length} snapshots, ${Object.keys(this._confidence).length} confidence entries`);
  }

  /**
   * Clear all stored validation data.
   */
  clearData() {
    this._snapshots = [];
    this._confidence = {};
    this.log('[Validator] All validation data cleared');
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Update confidence scores based on a new snapshot's deltas.
   */
  _updateConfidence(snapshot) {
    if (!snapshot.deltas) return;

    for (const [key, delta] of Object.entries(snapshot.deltas)) {
      const reg = CANDIDATE_REGISTERS.find(r => r.key === key);
      if (!reg || !reg.apiField) continue;

      if (!this._confidence[key]) {
        this._confidence[key] = {
          samples: 0,
          matchCount: 0,
          totalAbsDiff: 0,
          maxAbsDiff: 0,
          apiField: reg.apiField,
          transform: reg.transform,
          level: 'unresolved',
          matchRate: 0,
          avgAbsDiff: 0,
        };
      }

      const c = this._confidence[key];
      c.samples++;
      c.totalAbsDiff += delta.absDiff;
      c.avgAbsDiff = Math.round(c.totalAbsDiff / c.samples * 100) / 100;
      if (delta.absDiff > c.maxAbsDiff) c.maxAbsDiff = delta.absDiff;

      // Check acceptance
      const accept = ACCEPTANCE[reg.apiField];
      if (accept && delta.absDiff <= accept.maxAbsDiff) {
        c.matchCount++;
      }

      c.matchRate = c.samples > 0 ? Math.round(c.matchCount / c.samples * 100) : 0;

      // Determine level
      if (accept && c.samples >= accept.minSamples) {
        if (c.matchRate >= 95) c.level = 'high';
        else if (c.matchRate >= 75) c.level = 'medium';
        else if (c.matchRate >= 50) c.level = 'low';
        else c.level = 'unresolved';
      } else {
        c.level = c.samples < 5 ? 'unresolved' : (c.matchRate >= 80 ? 'medium' : 'low');
      }
    }
  }
}

module.exports = ModbusValidator;
module.exports.CANDIDATE_REGISTERS = CANDIDATE_REGISTERS;
module.exports.CANDIDATE_RANGES = CANDIDATE_RANGES;
module.exports.applyTransform = applyTransform;
module.exports.toSigned16 = toSigned16;
module.exports.toSigned32 = toSigned32;
