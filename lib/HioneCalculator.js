'use strict';

/**
 * HioneCalculator.js
 * Provides calculated metrics from normalized HiOne data.
 */

// Default usable battery capacity in kWh (HiOne 5kWh nominal)
const DEFAULT_USABLE_KWH = 5.0;

class HioneCalculator {

  /**
   * Determine battery direction based on batteryPower.
   * Positive = charging, negative = discharging.
   * @param {number} batteryPower
   * @returns {'charging'|'discharging'|'idle'}
   */
  static batteryDirection(batteryPower) {
    if (batteryPower > 10) return 'charging';
    if (batteryPower < -10) return 'discharging';
    return 'idle';
  }

  /**
   * Determine grid direction based on gridPower.
   * Positive = importing, negative = exporting.
   * @param {number} gridPower
   * @returns {'importing'|'exporting'|'neutral'}
   */
  static gridDirection(gridPower) {
    if (gridPower > 10) return 'importing';
    if (gridPower < -10) return 'exporting';
    return 'neutral';
  }

  /**
   * Calculate self-powered percentage.
   * Formula: ((load - grid_import) / load) * 100
   * @param {number} loadPower
   * @param {number} gridPower - positive = import
   * @returns {number} percentage 0-100
   */
  static selfPoweredPct(loadPower, gridPower) {
    if (loadPower <= 0) return 100;
    const gridImport = Math.max(0, gridPower);
    const pct = ((loadPower - gridImport) / loadPower) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  }

  /**
   * Estimate battery runtime in hours (discharging).
   * @param {number} soc - current SoC (0-100)
   * @param {number} dischargePower - discharge power in W (positive value)
   * @param {number} usableKwh - usable battery capacity in kWh
   * @returns {number|null} estimated hours remaining, or null if not discharging
   */
  static batteryRuntimeHours(soc, dischargePower, usableKwh = DEFAULT_USABLE_KWH) {
    if (dischargePower <= 0 || soc <= 0) return null;
    const remainingKwh = (usableKwh * soc) / 100;
    const dischargeKw = dischargePower / 1000;
    if (dischargeKw <= 0) return null;
    return Math.round((remainingKwh / dischargeKw) * 10) / 10;
  }

  /**
   * Estimate time to full in hours (charging).
   * @param {number} soc - current SoC (0-100)
   * @param {number} chargePower - charge power in W (positive value)
   * @param {number} usableKwh - usable battery capacity in kWh
   * @returns {number|null} estimated hours to full, or null if not charging
   */
  static timeToFullHours(soc, chargePower, usableKwh = DEFAULT_USABLE_KWH) {
    if (chargePower <= 0 || soc >= 100) return null;
    const missingKwh = (usableKwh * (100 - soc)) / 100;
    const chargeKw = chargePower / 1000;
    if (chargeKw <= 0) return null;
    return Math.round((missingKwh / chargeKw) * 10) / 10;
  }

  /**
   * Calculate power balance.
   * pv + grid + battery - load
   * @param {number} pvPower
   * @param {number} gridPower
   * @param {number} batteryPower
   * @param {number} loadPower
   * @returns {number}
   */
  static powerBalance(pvPower, gridPower, batteryPower, loadPower) {
    return Math.round(pvPower + gridPower + batteryPower - loadPower);
  }

  /**
   * Determine energy independence state.
   * @param {number} pvPower
   * @param {number} gridPower - positive = importing, negative = exporting
   * @param {number} batteryPower - positive = charging, negative = discharging
   * @param {number} loadPower
   * @returns {'self_sufficient'|'partly_importing'|'battery_supported'|'exporting_surplus'}
   */
  static energyState(pvPower, gridPower, batteryPower, loadPower) {
    if (gridPower < -10) return 'exporting_surplus';
    if (gridPower <= 10 && batteryPower < -10) return 'battery_supported';
    if (gridPower <= 10) return 'self_sufficient';
    return 'partly_importing';
  }
}

module.exports = HioneCalculator;
