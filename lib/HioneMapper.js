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
   * Normalize battery mode to enum ID "1"-"8".
   * Handles numeric, string-numeric, or human-readable mode names.
   */
  static _normMode(v) {
    const VALID_IDS = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const s = String(v ?? '1').trim();
    // Numeric string ID: "1"-"8"
    if (VALID_IDS.includes(s)) return s;
    // Named modes → map to 1-based ID
    const NAME_MAP = {
      'self-consumption': '1', 'self_consumption': '1', 'selfconsumption': '1',
      'economy': '2',
      'backup': '3', 'emergency': '3',
      'off-grid': '4', 'offgrid': '4', 'off_grid': '4',
      'self-consumption + max power': '5', 'self_consumption_max_power': '5',
      'backup + max power': '6', 'backup_max_power': '6',
      'peak shaving': '7', 'peak_shaving': '7', 'peakshaving': '7',
      'time of use': '8', 'time_of_use': '8', 'timeofuse': '8', 'tou': '8',
    };
    const lower = s.toLowerCase();
    if (NAME_MAP[lower]) return NAME_MAP[lower];
    // Try parsing as number
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 1 && n <= 8) return String(n);
    // Legacy 0-based: map 0→1
    if (n === 0) return '1';
    return '1'; // default: Self-Consumption
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
