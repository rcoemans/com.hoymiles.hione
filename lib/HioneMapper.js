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
      batterySoc:            HioneMapper._clamp(HioneMapper._num(raw.batterySoc), 0, 100),
      gridPower,
      gridImportPower:       Math.max(gridPower, 0),
      gridExportPower:       Math.max(-gridPower, 0),
      loadPower:             HioneMapper._num(raw.loadPower),
      batteryMode:           String(raw.batteryMode ?? '0'),
      dailyEnergy:           HioneMapper._num(raw.dailyEnergy),
      totalEnergy:           HioneMapper._num(raw.totalEnergy),
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
}

module.exports = HioneMapper;
