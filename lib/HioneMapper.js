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
      batteryMode:           String(raw.batteryMode ?? '0'),
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
   * Normalize energy value to kWh.
   * Cloud API may return Wh; if > 10000, assume Wh and convert.
   * Local API already returns kWh via its _kwh() helper.
   */
  static _normKwh(v) {
    let n = HioneMapper._num(v);
    if (Math.abs(n) > 10000) n = Math.round(n / 10) / 100; // Wh → kWh
    return n;
  }
}

module.exports = HioneMapper;
