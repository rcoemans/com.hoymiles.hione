'use strict';

/**
 * HioneMapper.js
 * Normalizes incoming data from local or cloud sources to a unified structure.
 */

class HioneMapper {

  /**
   * Normalize raw data from HoymilesHybrid into a unified structure.
   * @param {object} raw - Raw data from hybrid getData()
   * @returns {object} Normalized data
   */
  static normalize(raw) {
    const batteryPower = HioneMapper._num(raw.batteryPower);
    const gridPower    = HioneMapper._num(raw.gridPower);

    return {
      pvPower:               HioneMapper._num(raw.pvPower),
      batteryPower,
      batteryChargePower:    Math.max(batteryPower, 0),
      batteryDischargePower: Math.max(-batteryPower, 0),
      batterySoc:            HioneMapper._normPct(raw.batterySoc),
      gridPower,
      gridImportPower:       Math.max(gridPower, 0),
      gridExportPower:       Math.max(-gridPower, 0),
      loadPower:             HioneMapper._num(raw.loadPower),
      batteryMode:           HioneMapper._normMode(raw.batteryMode),
      dailyEnergy:           HioneMapper._normKwh(raw.dailyEnergy),
      totalEnergy:           HioneMapper._normKwh(raw.totalEnergy),
      source:                raw.source || 'unknown',
      online:                true,
      lastUpdated:           Date.now(),
    };
  }

  static _num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }

  static _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * Normalize a percentage value: handle 0-10000 range (100x too high)
   * and clamp to 0-100.
   */
  static _normPct(v) {
    let n = HioneMapper._num(v);
    if (n > 100) n = Math.round(n / 100);
    return HioneMapper._clamp(n, 0, 100);
  }

  /**
   * Normalize battery mode to enum ID "0"-"5".
   * Handles numeric, string-numeric, or human-readable mode names.
   */
  static _normMode(v) {
    const VALID_IDS = ['0', '1', '2', '3', '4', '5'];
    const s = String(v ?? '0').trim();
    // Numeric string ID: "0"-"5"
    if (VALID_IDS.includes(s)) return s;
    // Named modes → map to ID
    const NAME_MAP = {
      'self-consumption': '0', 'self_consumption': '0', 'selfconsumption': '0',
      'economy': '1',
      'backup': '2', 'emergency': '2',
      'off-grid': '3', 'offgrid': '3', 'off_grid': '3',
      'peak shaving': '4', 'peak_shaving': '4', 'peakshaving': '4',
      'time of use': '5', 'time_of_use': '5', 'timeofuse': '5', 'tou': '5',
    };
    const lower = s.toLowerCase();
    if (NAME_MAP[lower]) return NAME_MAP[lower];
    // Try parsing as number
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0 && n <= 5) return String(n);
    return '0'; // default: Self-Consumption
  }

  /**
   * Normalize energy value to kWh.
   * Both cloud API (via _energyKwh) and local API (via _kwh) already deliver kWh.
   * This just applies standard numeric rounding.
   */
  static _normKwh(v) {
    return HioneMapper._num(v);
  }
}

module.exports = HioneMapper;
