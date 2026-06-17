'use strict';

/**
 * HioneMapper.js
 * Normalizes incoming data from local or cloud sources to a unified structure.
 *
 * Sign conventions (confirmed from Hoymiles S-Miles Cloud API):
 *   batteryPower: positive = charging, negative = discharging
 *   gridPower:    positive = importing from grid, negative = exporting to grid
 *   loadPower:    always positive (household consumption)
 *   pvPower:      always positive (solar production)
 */

// Deadband to prevent state flickering on small values (Section 8 of mapping report)
const POWER_DEADBAND_W = 10;

// Plausibility ranges for validation (Section 11 of mapping report)
const VALID_RANGES = {
  pvPower:      { min: -500, max: 50000 },     // W — allow small negative measurement noise
  batteryPower: { min: -50000, max: 50000 },    // W — signed
  gridPower:    { min: -50000, max: 50000 },    // W — signed
  loadPower:    { min: -500, max: 50000 },      // W — allow small negative measurement noise
  batterySoc:   { min: 0, max: 100 },           // %
  dailyEnergy:  { min: 0, max: 200 },           // kWh — max 200 kWh/day for residential
  totalEnergy:  { min: 0, max: 100000 },        // kWh — max 100 MWh lifetime
};

class HioneMapper {

  /**
   * Normalize raw data from HoymilesHybrid into a unified structure.
   * Applies validation and deadbands per the mapping report recommendations.
   * @param {object} raw - Raw data from hybrid getData()
   * @param {Function} [log] - Optional logger for validation warnings
   * @returns {object} Normalized data with validation metadata
   */
  static normalize(raw, log) {
    const _log = typeof log === 'function' ? log : () => {};
    const source = raw.source || 'unknown';
    const rejected = [];

    // ── Validate and normalize power values ─────────────────────────
    const pvPower      = HioneMapper._validate('pvPower', raw.pvPower, source, rejected, _log);
    const batteryPower = HioneMapper._validate('batteryPower', raw.batteryPower, source, rejected, _log);
    const gridPower    = HioneMapper._validate('gridPower', raw.gridPower, source, rejected, _log);
    const loadPower    = HioneMapper._validate('loadPower', raw.loadPower, source, rejected, _log);

    // ── Battery charge/discharge split with deadband ────────────────
    const { chargePowerW, dischargePowerW, state: batteryState } =
      HioneMapper._splitBatteryPower(batteryPower);

    // ── Grid import/export split with deadband ──────────────────────
    const { importPowerW, exportPowerW, state: gridState } =
      HioneMapper._splitGridPower(gridPower);

    // ── Energy validation ───────────────────────────────────────────
    const dailyEnergy = HioneMapper._validate('dailyEnergy', raw.dailyEnergy, source, rejected, _log);
    const totalEnergy = HioneMapper._validate('totalEnergy', raw.totalEnergy, source, rejected, _log);

    // Cross-check: daily must not exceed total (allow small rounding tolerance)
    if (dailyEnergy > 0 && totalEnergy > 0 && dailyEnergy > totalEnergy + 0.5) {
      _log(`[Mapper] WARNING: dailyEnergy (${dailyEnergy}) > totalEnergy (${totalEnergy}) from ${source} — clamping daily to total`);
    }

    // ── SoC and mode ────────────────────────────────────────────────
    const batterySoc  = HioneMapper._normPct(raw.batterySoc);
    const batteryMode = HioneMapper._normMode(raw.batteryMode);

    // ── Passthrough confidence metadata from Modbus ─────────────────
    const confidence = raw.confidence || null;

    return {
      pvPower,
      batteryPower,
      batteryChargePower:    chargePowerW,
      batteryDischargePower: dischargePowerW,
      batterySoc,
      gridPower,
      gridImportPower:       importPowerW,
      gridExportPower:       exportPowerW,
      loadPower,
      batteryMode,
      dailyEnergy:           Math.min(dailyEnergy, totalEnergy > 0 ? totalEnergy : dailyEnergy),
      totalEnergy,
      source,
      online:                true,
      lastUpdated:           Date.now(),
      confidence,
      rejected,
    };
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  /**
   * Validate a named value against its plausibility range.
   * Returns 0 (and logs + records rejection) if the value is implausible.
   */
  static _validate(name, rawValue, source, rejected, log) {
    const n = HioneMapper._num(rawValue);
    const range = VALID_RANGES[name];
    if (!range) return n;

    if (!Number.isFinite(n)) {
      log(`[Mapper] REJECTED ${name}=${rawValue} from ${source}: non-finite`);
      rejected.push({ name, raw: rawValue, reason: 'non-finite' });
      return 0;
    }

    if (n < range.min || n > range.max) {
      log(`[Mapper] REJECTED ${name}=${n} from ${source}: outside range [${range.min}, ${range.max}]`);
      rejected.push({ name, raw: rawValue, mapped: n, reason: `outside [${range.min}, ${range.max}]` });
      return 0;
    }

    return n;
  }

  /**
   * Validate a capability value by name. Public API for external callers.
   * @param {string} name
   * @param {*} value
   * @returns {{ ok: boolean, reason?: string }}
   */
  static validateCapabilityValue(name, value) {
    if (!Number.isFinite(value) && typeof value !== 'string' && typeof value !== 'boolean') {
      return { ok: false, reason: 'invalid type or non-finite value' };
    }
    const range = VALID_RANGES[name];
    if (range && typeof value === 'number') {
      if (value < range.min || value > range.max) {
        return { ok: false, reason: `${name} = ${value} outside [${range.min}, ${range.max}]` };
      }
    }
    return { ok: true };
  }

  // ── Deadband splits (Section 8 of mapping report) ───────────────────────────

  /**
   * Split battery power into charge/discharge with deadband.
   * Positive batteryPower = charging, negative = discharging.
   */
  static _splitBatteryPower(batteryPowerW) {
    if (!Number.isFinite(batteryPowerW)) {
      return { chargePowerW: 0, dischargePowerW: 0, state: 'idle' };
    }
    if (batteryPowerW > POWER_DEADBAND_W) {
      return { chargePowerW: batteryPowerW, dischargePowerW: 0, state: 'charging' };
    }
    if (batteryPowerW < -POWER_DEADBAND_W) {
      return { chargePowerW: 0, dischargePowerW: Math.abs(batteryPowerW), state: 'discharging' };
    }
    return { chargePowerW: 0, dischargePowerW: 0, state: 'idle' };
  }

  /**
   * Split grid power into import/export with deadband.
   * Positive gridPower = importing, negative = exporting.
   */
  static _splitGridPower(gridPowerW) {
    if (!Number.isFinite(gridPowerW)) {
      return { importPowerW: 0, exportPowerW: 0, state: 'neutral' };
    }
    if (gridPowerW > POWER_DEADBAND_W) {
      return { importPowerW: gridPowerW, exportPowerW: 0, state: 'importing' };
    }
    if (gridPowerW < -POWER_DEADBAND_W) {
      return { importPowerW: 0, exportPowerW: Math.abs(gridPowerW), state: 'exporting' };
    }
    return { importPowerW: 0, exportPowerW: 0, state: 'neutral' };
  }

  // ── Numeric helpers ─────────────────────────────────────────────────────────

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
   *
   * Cloud API mode codes:
   *   1000 → Self-Consumption (mode 1)
   *   Other codes TBD — see operatingModeMap in mapping report.
   */
  static _normMode(v) {
    const VALID_IDS = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const s = String(v ?? '1').trim();
    // Numeric string ID: "1"-"8"
    if (VALID_IDS.includes(s)) return s;
    // Cloud API mode codes (1000-series)
    const CLOUD_MODE_MAP = {
      '1000': '1', // Self-Consumption
      '1001': '2', // Economy
      '1002': '3', // Backup
      '1003': '4', // Off-Grid
      '1004': '5', // Self-Consumption + Max Power
      '1005': '6', // Backup + Max Power
      '1006': '7', // Peak Shaving
      '1007': '8', // Time of Use
    };
    if (CLOUD_MODE_MAP[s]) return CLOUD_MODE_MAP[s];
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
module.exports.POWER_DEADBAND_W = POWER_DEADBAND_W;
module.exports.VALID_RANGES = VALID_RANGES;
