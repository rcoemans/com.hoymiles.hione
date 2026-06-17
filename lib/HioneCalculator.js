'use strict';

/**
 * HioneCalculator.js
 * Provides calculated metrics from normalized HiOne data.
 *
 * Sign conventions:
 *   batteryPower: positive = charging, negative = discharging
 *   gridPower:    positive = importing from grid, negative = exporting to grid
 */

// Deadband to prevent state flickering (matches HioneMapper.POWER_DEADBAND_W)
const POWER_DEADBAND_W = 10;

// Default usable battery capacity in kWh
// HiOne: 4 × 8 kWh modules = 32 kWh nameplate, ~30 kWh usable
const DEFAULT_CAPACITY_KWH = 30.0;

class HioneCalculator {

  /**
   * Determine battery direction based on batteryPower.
   * Positive = charging, negative = discharging.
   * Uses deadband to prevent flickering.
   * @param {number} batteryPower
   * @returns {'charging'|'discharging'|'idle'}
   */
  static batteryDirection(batteryPower) {
    if (!Number.isFinite(batteryPower)) return 'idle';
    if (batteryPower > POWER_DEADBAND_W) return 'charging';
    if (batteryPower < -POWER_DEADBAND_W) return 'discharging';
    return 'idle';
  }

  /**
   * Determine grid direction based on gridPower.
   * Positive = importing, negative = exporting.
   * Uses deadband to prevent flickering.
   * @param {number} gridPower
   * @returns {'importing'|'exporting'|'neutral'}
   */
  static gridDirection(gridPower) {
    if (!Number.isFinite(gridPower)) return 'neutral';
    if (gridPower > POWER_DEADBAND_W) return 'importing';
    if (gridPower < -POWER_DEADBAND_W) return 'exporting';
    return 'neutral';
  }

  /**
   * Calculate self-powered percentage.
   * Formula: ((load - grid_import) / load) * 100
   * @param {number} loadPower
   * @param {number} gridPower - positive = import
   * @returns {number} percentage 0-100, or null if values are not finite
   */
  static selfPoweredPct(loadPower, gridPower) {
    if (!Number.isFinite(loadPower) || !Number.isFinite(gridPower)) return null;
    if (loadPower <= 0) return 100;
    const gridImport = Math.max(0, gridPower);
    const localSupply = Math.max(0, loadPower - gridImport);
    const pct = (localSupply / loadPower) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  }

  /**
   * Estimate battery runtime in hours (discharging).
   * Uses reserveSoc as the floor — battery stops discharging at reserve.
   * @param {number} soc - current SoC (0-100)
   * @param {number} dischargePower - discharge power in W (positive value)
   * @param {number} [capacityKwh] - battery capacity in kWh
   * @param {number} [reserveSoc] - reserve SoC percentage (0-100)
   * @returns {number|null} estimated hours remaining, or null if not discharging
   */
  static batteryRuntimeHours(soc, dischargePower, capacityKwh = DEFAULT_CAPACITY_KWH, reserveSoc = 10) {
    if (!Number.isFinite(soc) || !Number.isFinite(dischargePower) ||
        !Number.isFinite(capacityKwh) || !Number.isFinite(reserveSoc)) return null;
    if (dischargePower <= 0 || soc <= reserveSoc) return null;
    const usablePercent = Math.max(0, soc - reserveSoc);
    const usableKwh = (capacityKwh * usablePercent) / 100;
    const dischargeKw = dischargePower / 1000;
    if (dischargeKw <= 0) return null;
    return Math.round((usableKwh / dischargeKw) * 10) / 10;
  }

  /**
   * Estimate time to full in hours (charging).
   * Uses maxSoc as the ceiling — battery stops charging at max.
   * @param {number} soc - current SoC (0-100)
   * @param {number} chargePower - charge power in W (positive value)
   * @param {number} [capacityKwh] - battery capacity in kWh
   * @param {number} [maxSoc] - max SoC percentage (0-100)
   * @returns {number|null} estimated hours to full, or null if not charging
   */
  static timeToFullHours(soc, chargePower, capacityKwh = DEFAULT_CAPACITY_KWH, maxSoc = 100) {
    if (!Number.isFinite(soc) || !Number.isFinite(chargePower) ||
        !Number.isFinite(capacityKwh) || !Number.isFinite(maxSoc)) return null;
    if (chargePower <= 0 || soc >= maxSoc) return null;
    const remainingPercent = Math.max(0, maxSoc - soc);
    const remainingKwh = (capacityKwh * remainingPercent) / 100;
    const chargeKw = chargePower / 1000;
    if (chargeKw <= 0) return null;
    return Math.round((remainingKwh / chargeKw) * 10) / 10;
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
    if (gridPower < -POWER_DEADBAND_W) return 'exporting_surplus';
    if (gridPower <= POWER_DEADBAND_W && batteryPower < -POWER_DEADBAND_W) return 'battery_supported';
    if (gridPower <= POWER_DEADBAND_W) return 'self_sufficient';
    return 'partly_importing';
  }
}

module.exports = HioneCalculator;
module.exports.DEFAULT_CAPACITY_KWH = DEFAULT_CAPACITY_KWH;
module.exports.POWER_DEADBAND_W = POWER_DEADBAND_W;
